import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const checkOnly = process.argv.includes('--check');
const noOpen = process.argv.includes('--no-open');
const python = path.join(root, '.venv/bin/python');
const vite = path.join(root, 'node_modules/vite/bin/vite.js');
const children = [];
let stopping = false;

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} 执行失败，请查看上方提示。`);
  }
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  // Each service owns a process group, including any video-processing children.
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  }
  const timer = setTimeout(() => {
    for (const child of children) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
    process.exit(code);
  }, 5000);
  timer.unref();
  process.exitCode = code;
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => stop());
}

function launch(command, args, label) {
  const child = spawn(command, args, { stdio: 'inherit', detached: true });
  children.push(child);
  child.on('error', error => {
    console.error(`${label}启动失败：${error.message}`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`${label}已退出（${signal ?? code}），正在关闭另一服务。`);
      stop(1);
    }
  });
}

async function requireFreePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(
      `端口 ${port} 已被占用。请先关闭旧的启动窗口或占用该端口的服务，再重试。`,
    )));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

async function waitForServices() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && !stopping) {
    try {
      const health = await fetch('http://127.0.0.1:8000/api/health', {
        signal: AbortSignal.timeout(1500),
      });
      const info = await health.json();
      const proxy = await fetch('http://127.0.0.1:3000/api/health', {
        signal: AbortSignal.timeout(1500),
      });
      const proxyInfo = await proxy.json();
      const page = await fetch('http://127.0.0.1:3000', {
        signal: AbortSignal.timeout(1500),
      });
      if (health.ok && info.ok && info.method === 'pose_audio_v1'
          && proxy.ok && proxyInfo.method === 'pose_audio_v1' && page.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!stopping) throw new Error('服务启动超过 60 秒，请查看上方日志。');
}

try {
  if (process.platform === 'win32') throw new Error('此启动入口支持 macOS / Linux。');
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('请安装 Node.js 20+。');

  if (!existsSync(python)) {
    if (checkOnly) throw new Error('尚未创建 .venv；运行 npm start 自动准备环境。');
    console.log('首次启动：使用 Python 3.12 创建本地环境…');
    run('python3.12', ['-m', 'venv', '.venv']);
  }
  const version = spawnSync(python, ['-c',
    'import sys; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)',
  ]);
  if (version.error || version.status !== 0) throw new Error('.venv 需要可用的 Python 3.12。');

  const dependencies = spawnSync(python, ['-c',
    "import importlib.util, sys; sys.exit(0 if all(importlib.util.find_spec(m) for m in ['ultralytics', 'torch', 'cv2', 'numpy', 'scipy', 'imageio_ffmpeg', 'fastapi', 'uvicorn', 'python_multipart', 'httpx']) else 1)",
  ]);
  if (dependencies.error || dependencies.status !== 0) {
    if (checkOnly) throw new Error('缺少 Python 依赖；运行 npm start 自动安装。');
    console.log('首次启动：安装本地分析依赖，可能需要几分钟…');
    run(python, ['-m', 'pip', 'install', '-r', 'backend/requirements.txt']);
  }
  if (!existsSync(vite) || !existsSync('node_modules/react/package.json')) {
    if (checkOnly) throw new Error('缺少前端依赖；运行 npm start 自动安装。');
    console.log('首次启动：安装页面依赖…');
    run('npm', ['install']);
  }
  if (checkOnly) {
    console.log('运行环境检查通过：Node.js、Python 3.12 和前后端依赖已就绪。');
  } else {
    await Promise.all([requireFreePort(3000), requireFreePort(8000)]);
    console.log(`正在启动 MatchClip AI（分析设备：${process.env.MATCHCLIP_DEVICE || 'cpu'}）…`);
    launch(python, ['-m', 'uvicorn', 'backend.server:app', '--host', '127.0.0.1', '--port', '8000'], '后端');
    launch(process.execPath, [vite, '--host', '127.0.0.1', '--port', '3000', '--strictPort', '--clearScreen', 'false'], '页面');
    await waitForServices();
    if (!stopping) {
      console.log('\n已就绪：http://127.0.0.1:3000\n选择视频 → 开始视觉分析 → 复核片段 → 导出 MP4。\n保持此窗口打开，按 Ctrl+C 停止前后端。');
      if (!noOpen) {
        const opener = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', ['http://127.0.0.1:3000'], { stdio: 'ignore' });
        opener.on('error', () => console.log('请手动打开上方网址。'));
      }
    }
  }
} catch (error) {
  console.error(`\n${error.message}`);
  stop(1);
}
