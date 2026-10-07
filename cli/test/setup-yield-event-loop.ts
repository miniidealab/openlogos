/**
 * 每条用例结束后让出一次宏任务（vitest setupFiles，全局生效）。
 *
 * 原因：vitest worker 在用例开始 / 结束时以 birpc 向主线程发送 onTaskUpdate，并为每次调用挂 60s 超时定时器；
 * 主线程的应答要等 worker 事件循环进入 poll 阶段才会被处理。用例之间 runner 只经过微任务，
 * 若一个测试文件全是同步用例（大量 spawnSync 驱动真实 guard / CLI），整个文件期间事件循环从不轮转，
 * 文件累计超过 60s 时，循环恢复后 timers 阶段先于 poll 触发超时，报
 * `[vitest-worker]: Timeout calling "onTaskUpdate"`（用例全过但 vitest 退出码为 1）。
 *
 * 每条用例后 await 一次真实 setTimeout(0)（在本文件加载时捕获，不受 vi.useFakeTimers 影响），
 * 让事件循环走完一轮、及时消费 RPC 应答。不改变任何用例的断言与执行顺序。
 */
import { afterEach } from 'vitest';

const realSetTimeout = globalThis.setTimeout;

afterEach(() => new Promise<void>(resolve => { realSetTimeout(resolve, 0); }));
