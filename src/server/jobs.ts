import { uid } from '../shared/ids';
import { bus } from './events';

type Report = (progress: number, detail?: string) => void;

interface QueuedJob {
  run: () => Promise<void>;
}

/** Small concurrency-limited queue whose progress is streamed to the editor. */
export class JobQueue {
  private active = 0;
  private waiting: QueuedJob[] = [];

  constructor(private readonly concurrency: number) {}

  add<T>(projectId: string, label: string, fn: (report: Report) => Promise<T>): Promise<T> {
    const id = uid('job');
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        this.active++;
        const report: Report = (progress, detail) => bus.emit(projectId, { type: 'job', id, label, status: 'running', progress, detail });
        report(0);
        try {
          const result = await fn(report);
          bus.emit(projectId, { type: 'job', id, label, status: 'done', progress: 1 });
          resolve(result);
        } catch (err) {
          bus.emit(projectId, { type: 'job', id, label, status: 'error', detail: (err as Error).message });
          reject(err);
        } finally {
          this.active--;
          this.next();
        }
      };
      this.waiting.push({ run });
      this.next();
    });
  }

  private next() {
    while (this.active < this.concurrency && this.waiting.length > 0) void this.waiting.shift()!.run();
  }
}

export const analysisQueue = new JobQueue(2);
export const transcriptionQueue = new JobQueue(1);
export const generationQueue = new JobQueue(3);
