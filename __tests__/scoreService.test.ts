import {describe,it,expect} from 'vitest';
import {scoreEngine} from '../services/scoreService';
import {RallyClip} from '../types';
const rally=(id:number,extra:Partial<RallyClip>={}):RallyClip=>({id,start:id*10,end:id*10+5,hits:4,...extra});
describe('evidence-based scores',()=>{
  it('100 default A servers never fabricate 100:0',()=>{
    const result=scoreEngine.processRallies(Array.from({length:100},(_,i)=>rally(i,{serverSide:'A'})));
    expect(result.at(-1)?.scoreStateAfter.scoreA).toBeNull();expect(result.every(r=>!r.winner)).toBe(true);
  });
  it('does not assume 0:0 for a video starting mid-game',()=>{
    expect(scoreEngine.processRallies([rally(1,{winner:'B'})])[0].scoreStateAfter.scoreB).toBeNull();
  });
  it('adds only confirmed winners after a score anchor',()=>{
    const result=scoreEngine.processRallies([rally(1,{scoreBefore:{a:2,b:8},winner:'A'}),rally(2,{winner:'B'})]);
    expect(result[1].scoreStateAfter).toMatchObject({scoreA:3,scoreB:9});
  });
  it('an unknown rally invalidates subsequent cumulative scores',()=>{
    const result=scoreEngine.processRallies([rally(1,{scoreBefore:{a:2,b:8}}),rally(2,{winner:'A'})]);
    expect(result[1].scoreStateAfter.scoreA).toBeNull();
  });
  it('a later anchor recovers after an unknown point or game change',()=>{
    const result=scoreEngine.processRallies([rally(1),rally(2,{scoreBefore:{a:0,b:0},winner:'B'})]);
    expect(result[1].scoreStateAfter.scoreB).toBe(1);
  });
  it('the final point remains unknown without an explicit winner',()=>{
    const r=scoreEngine.processRallies([rally(1,{serverSide:'B',scoreBefore:{a:19,b:20}})])[0];
    expect(r.winner).toBeUndefined();expect(r.scoreStateAfter.scoreB).toBeNull();
  });
  it('does not mutate source projects',()=>{
    const input=[rally(1,{scoreBefore:{a:0,b:0},winner:'A'})];const before=JSON.stringify(input);
    scoreEngine.processRallies(input);expect(JSON.stringify(input)).toBe(before);
  });
});
