/* eslint-env jest */
jest.mock('../../messageEmitter', () => ({ emitMessage: jest.fn() }));
const { VideoActivity } = require('../videoActivity');
const MessageEmitter = require('../../messageEmitter');
const A = 'aaaaaaaaaaa';
const B = 'bbbbbbbbbbb';
const url = id => `https://www.youtube.com/watch?v=${id}`;

describe('video queue ownership', () => {
  let activity;
  beforeEach(() => {
    activity = new VideoActivity();
    jest.clearAllMocks();
  });

  it('deduplicates URL aliases and admits only unclaimed videos across jobs', () => {
    const first = activity.claim('first', [url(A), `https://youtu.be/${A}`]);
    expect(first.acceptedIds).toEqual([A]);
    expect(first.acceptedUrls).toHaveLength(1);
    const second = activity.claim('second', [`https://youtube.com/shorts/${A}`, url(B)]);
    expect(second.acceptedIds).toEqual([B]);
    expect(second.alreadyActiveIds).toEqual([A]);
    expect(activity.snapshot().videos).toEqual({
      [A]: { jobId: 'first', state: 'queued' },
      [B]: { jobId: 'second', state: 'queued' },
    });
  });

  it('marks only the current item downloading and releases the previous attempt', () => {
    activity.claim('batch', [url(A), url(B)]);
    activity.start('batch', A);
    expect(activity.snapshot().videos[B].state).toBe('queued');
    activity.start('batch', B);
    expect(activity.snapshot().videos[A]).toBeUndefined();
    expect(activity.snapshot().videos[B].state).toBe('downloading');
  });

  it('keeps pending ownership when a sweep discovers the same video', () => {
    activity.claim('pending', [url(A)]);
    activity.start('sweep', A);
    expect(activity.snapshot().videos[A]).toEqual({ jobId: 'sweep', state: 'downloading' });
    activity.finish('sweep', A);
    expect(activity.snapshot().videos[A]).toEqual({ jobId: 'pending', state: 'queued' });
  });

  it('does not let old completion erase an admitted retry', () => {
    activity.claim('first', [url(A)]);
    activity.start('first', A);
    activity.finish('first', A);
    activity.claim('retry', [url(A)]);
    activity.finishJob('first');
    activity.finish('first', A);
    expect(activity.snapshot().videos[A]).toEqual({ jobId: 'retry', state: 'queued' });
  });

  it('releases all remaining IDs on cancellation or failed enqueue', () => {
    activity.claim('failed', [url(A), url(B)]);
    activity.start('failed', A);
    activity.finishJob('failed');
    expect(activity.snapshot().videos).toEqual({});
    expect(activity.claim('replacement', [url(A), url(B)]).acceptedIds).toEqual([A, B]);
  });

  it('emits only transitions, with monotonically increasing revisions', () => {
    activity.claim('job', [url(A)]);
    activity.start('job', A);
    activity.start('job', A); // another audio/video destination for this video
    activity.finish('other', A);
    expect(MessageEmitter.emitMessage).toHaveBeenCalledTimes(2);
    expect(activity.snapshot().revision).toBe(2);
  });

  it('starts empty after a server restart with a different instance ID', () => {
    activity.claim('job', [url(A)]);
    const restarted = new VideoActivity();
    expect(restarted.snapshot().videos).toEqual({});
    expect(restarted.snapshot().instanceId).not.toBe(activity.snapshot().instanceId);
  });
});
