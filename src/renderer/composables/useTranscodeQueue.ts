import { ref } from 'vue';
import type { TranscodeJob } from '../../core/types';
import { api } from '../api';

export function useTranscodeQueue() {
  const jobStatusMap = ref<Map<string, TranscodeJob['status']>>(new Map());
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const poll = async () => {
    try {
      const jobs = await api.listTranscodeJobs();
      jobStatusMap.value = new Map(jobs.map((j) => [j.file_path, j.status]));
    } catch {
      // Swallow polling errors to avoid noise
    }
  };

  const startPolling = () => {
    poll();
    pollTimer = setInterval(poll, 2000);
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const addJobs = async (paths: string[]) => {
    await api.addTranscodeJobs(paths);
    poll();
  };

  const cancelJob = async (path: string) => {
    await api.cancelTranscodeJob(path);
    poll();
  };

  return { jobStatusMap, startPolling, stopPolling, addJobs, cancelJob };
}
