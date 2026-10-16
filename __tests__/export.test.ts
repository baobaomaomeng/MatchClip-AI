import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateFFmpegScript} from '../services/ffmpegService';
it('generated script treats filenames as literal data and contains no guessed score',()=>{
  const dir=mkdtempSync(join(tmpdir(),'matchclip-shell-'));
  try{
    const log=join(dir,'args');
    writeFileSync(join(dir,'ffmpeg'),'#!/bin/sh\nprintf "%s\\n" "$@" >> "$MATCHCLIP_LOG"\n',{mode:0o755});
    const filename="match ' $(touch injected).mp4";
    const script=generateFFmpegScript(filename,[{id:1,start:2,end:4,hits:4}]);
    writeFileSync(join(dir,'run.sh'),script);
    execFileSync('bash',[join(dir,'run.sh')],{cwd:dir,env:{...process.env,PATH:dir+':'+process.env.PATH,MATCHCLIP_LOG:log}});
    expect(readFileSync(log,'utf8')).toContain(filename);expect(existsSync(join(dir,'injected'))).toBe(false);expect(script).not.toContain('drawtext');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
it('refuses overlapping exports',()=>expect(()=>generateFFmpegScript('a.mp4',[{id:1,start:1,end:3,hits:0},{id:2,start:2,end:4,hits:0}])).toThrow());
