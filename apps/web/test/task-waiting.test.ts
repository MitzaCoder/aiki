import { expect, test } from 'bun:test';
import type { BoardTask } from '@aiki/protocol';
import { TASK_STATUS_CHOICES, waitingDateIn, waitingSummary } from '../src/lib/task-waiting.ts';
import { taskSections } from '../src/lib/tasks.ts';
import { groupTasks } from '../src/lib/board.ts';
import { columnOfStatus, kanbanColumns, dropTarget } from '../src/lib/kanban.ts';
const task = (id:string,status:BoardTask['status']):BoardTask=>({id,status,order:Number(id.slice(1)),archived:false,updatedAt:'2026-11-10T00:00:00Z',report:{now:'',results:'',next:'',revision:0,updatedAt:null,updatedBy:null},waiting:status==='waiting'?{note:'Ana approval',since:'2026-11-07T00:00:00Z',until:'2026-11-14T00:00:00Z',by:'user'}:undefined} as BoardTask);
test('Waiting follows Review and is folded in both lists',()=>{const tasks=[task('T1','waiting'),task('T2','review')];const groups=taskSections({tasks,questions:[]});expect(groups.map(g=>g.id)).toEqual(['review','waiting']);expect(groups[1]?.collapsedByDefault).toBe(true);expect(groupTasks(tasks)[1]).toMatchObject({status:'waiting',collapsedByDefault:true});});
test('Waiting has its own column after Review and refuses bare drops without a note',()=>{expect(columnOfStatus('waiting')).toBe('waiting');const columns=kanbanColumns({tasks:[task('T1','waiting')],questions:[]});expect(columns.map(c=>c.id)).toEqual(['todo','working','blocked','review','waiting','done']);expect(columns[4]?.cards[0]?.task.id).toBe('T1');expect(dropTarget('waiting')).toBeUndefined();});
test('status menu covers every status with a label and hint',()=>{expect(TASK_STATUS_CHOICES.map(c=>c.status)).toEqual(['todo','in_progress','blocked','review','waiting','done','dropped']);expect(TASK_STATUS_CHOICES.every(c=>c.label&&c.hint)).toBe(true);});
test('summary preserves notes already beginning with waiting for, regardless of case',()=>{
 for(const note of ['Waiting for rebase','waiting for rebase','WAITING FOR rebase','  Waiting for rebase']){
  const value=task('T1','waiting');value.waiting!.note=note;
  expect(waitingSummary(value)).toStartWith(`${note} · since`);
 }
});
test('summary and date quick picks preserve the calendar date',()=>{expect(waitingSummary(task('T1','waiting'),Date.parse('2026-11-10T00:00:00Z'))).toContain('Ana approval · since 3d · back on');expect(waitingDateIn(3,new Date(2026,11,30,20))).toBe('2027-01-02');expect(waitingSummary({})).toBe('');});
