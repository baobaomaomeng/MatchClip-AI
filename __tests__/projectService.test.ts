import {describe,it,expect} from 'vitest';
import {parseProject} from '../services/projectService';
const clip={id:1,start:10,end:20,hits:4,serverSide:'A',winner:'A',reviewStatus:'accepted'};
describe('project import',()=>{
  it('clears fabricated near/far scores on legacy imports',()=>{
    const r=parseProject({rallies:[clip]}).rallies[0];expect(r.winner).toBeNull();expect(r.serverSide).toBeNull();expect(r.reviewStatus).toBe('pending');
  });
  it('preserves unknowns, manual review and score anchors in v2',()=>{
    const r=parseProject({metadata:{version:'2.0'},rallies:[{...clip,winner:null,serverSide:null,scoreBefore:{a:2,b:8},hitSource:'unknown'}]}).rallies[0];
    expect(r.winner).toBeNull();expect(r.reviewStatus).toBe('accepted');expect(r.scoreBefore).toEqual({a:2,b:8});expect(r.hitSource).toBe('unknown');
  });
  it.each([NaN,Infinity,-1,'12'])('rejects invalid timestamps: %s',start=>expect(()=>parseProject({rallies:[{...clip,start}]})).toThrow());
  it('rejects overlapping and out-of-video intervals',()=>{
    expect(()=>parseProject({rallies:[clip,{...clip,start:19,end:25}]})).toThrow();
    expect(()=>parseProject({rallies:[clip]},15)).toThrow();
  });
  it('rejects malformed analysis metadata and projects for a shorter video',()=>{
    for(const metadata of [{analysisStart:'0'},{analysisStart:-2},{analysisEnd:Infinity},{analysisStart:30,analysisEnd:20},{sourceDuration:-1}]) {
      expect(()=>parseProject({metadata,rallies:[clip]})).toThrow();
    }
    expect(()=>parseProject({metadata:{analysisEnd:100},rallies:[clip]},30)).toThrow();
  });
});
