import {RallyClip} from '../types';
const shellQuote=(value:string)=>"'"+value.replace(/'/g,"'\\''")+"'";
/** Executable offline export, with precise re-encoding and no fabricated score overlay. */
export function generateFFmpegScript(filename:string,rallies:RallyClip[]):string {
  if(!rallies.length)throw new Error('没有可导出的片段');
  const sorted=[...rallies].sort((a,b)=>a.start-b.start);
  sorted.forEach((r,i)=>{if(!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end<=r.start||i>0&&r.start<sorted[i-1].end)throw new Error('片段时间无效或重叠');});
  const commands=sorted.map((r,i)=>`ffmpeg -hide_banner -loglevel error -y -ss ${r.start} -i "$input" -t ${(r.end-r.start).toFixed(3)} -map 0:v:0 -map '0:a:0?' -c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 128k "$work/${i}.mp4"`).join('\n');
  const entries=sorted.map((_,i)=>`file '${i}.mp4'`).join('\n');
  return `#!/usr/bin/env bash
set -euo pipefail
# 在原视频目录运行；也可把原视频绝对路径作为第一个参数传入。
# 导出候选片段，不添加未经确认的比分或拍数。
input=\${1:-${shellQuote(filename)}}
output=\${2:-highlights.mp4}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
${commands}
cat > "$work/clips.txt" <<'MATCHCLIP_SEGMENTS'
${entries}
MATCHCLIP_SEGMENTS
ffmpeg -hide_banner -loglevel error -n -f concat -safe 1 -i "$work/clips.txt" -c copy -movflags +faststart "$output"
`;
}
