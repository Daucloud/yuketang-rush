// Local observations only: a playing video does not prove server-side credit.
export function recordMedia(task, raw, now = Date.now()) {
  if (!raw || !Number.isFinite(raw.time) || raw.time < 0 || !Number.isFinite(raw.rate)) return;
  const media = {time:raw.time, duration:Number.isFinite(raw.duration)?raw.duration:null,
    rate:raw.rate, visible:raw.visible === true, focused:raw.focused === true,
    paused:raw.paused === true, ended:raw.ended === true,
    stalledFor:Number.isFinite(raw.stalledFor)?Math.max(0,raw.stalledFor):0};
  task.media = media;
  task.mediaSeenAt = now;
  const condition = !media.visible ? 'hidden' : media.ended ? 'ended' : media.paused ? 'paused'
    : media.stalledFor >= 15 ? 'stalled' : media.focused ? 'focused' : 'unfocused';
  task.diagnostic = condition;
  task.mediaHistory ||= [];
  const last = task.mediaHistory.at(-1);
  if (!last || now-last.at >= 12000 || last.condition !== condition || last.rate !== media.rate) {
    task.mediaHistory.push({at:now, condition, ...media});
    task.mediaHistory = task.mediaHistory.slice(-180);
  }
}

export function recordGap(task, now = Date.now()) {
  if (task.diagnostic === 'no-report') return;
  task.diagnostic = 'no-report';
  task.mediaHistory ||= [];
  task.mediaHistory.push({at:now, condition:'no-report'});
  task.mediaHistory = task.mediaHistory.slice(-180);
}

export const diagnosticNames = {hidden:'页面隐藏', ended:'播放结束', paused:'播放器暂停',
  stalled:'播放时间停滞', focused:'有焦点，页面可见', unfocused:'无焦点，页面可见', 'no-report':'页面状态未更新'};
