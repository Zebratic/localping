const { Worker } = require('worker_threads');
const path = require('path');

/**
 * Worker Pool Manager - manages a pool of worker threads for ping operations
 */
class WorkerPool {
  constructor(size = 4) {
    this.size = size;
    this.workers = [];
    this.queue = [];
    this.activeTasks = new Map();
    this.taskIdCounter = 0;
    this.initialized = false;
  }

  /**
   * Initialize the worker pool
   */
  initialize() {
    if (this.initialized) return;
    
    const workerPath = path.join(__dirname, 'pingWorker.js');
    
    for (let i = 0; i < this.size; i++) {
      const worker = new Worker(workerPath);
      
      worker.on('message', (message) => {
        const { id, result } = message;
        const task = this.activeTasks.get(id);
        
        if (task) {
          task.resolve(result);
          this.activeTasks.delete(id);
        }
        
        this.processQueue();
      });
      
      worker.on('error', (error) => {
        console.error(`Worker error:`, error);
        // Remove failed worker and create a new one
        const index = this.workers.indexOf(worker);
        if (index > -1) {
          this.workers.splice(index, 1);
          this.createWorker();
        }
      });
      
      worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`Worker exited with code ${code}`);
          const index = this.workers.indexOf(worker);
          if (index > -1) {
            this.workers.splice(index, 1);
            this.createWorker();
          }
        }
      });
      
      this.workers.push({
        worker,
        busy: false,
      });
    }
    
    this.initialized = true;
  }

  /**
   * Create a new worker to replace a failed one
   */
  createWorker() {
    const workerPath = path.join(__dirname, 'pingWorker.js');
    const worker = new Worker(workerPath);
    
    worker.on('message', (message) => {
      const { id, result } = message;
      const task = this.activeTasks.get(id);
      
      if (task) {
        task.resolve(result);
        this.activeTasks.delete(id);
      }
      
      // Mark worker as not busy
      const workerInfo = this.workers.find(w => w.worker === worker);
      if (workerInfo) {
        workerInfo.busy = false;
      }
      
      this.processQueue();
    });
    
    worker.on('error', (error) => {
      console.error(`Worker error:`, error);
      const index = this.workers.findIndex(w => w.worker === worker);
      if (index > -1) {
        this.workers[index].worker.terminate();
        this.workers.splice(index, 1);
      }
    });
    
    worker.on('exit', (code) => {
      if (code !== 0) {
        const index = this.workers.findIndex(w => w.worker === worker);
        if (index > -1) {
          this.workers.splice(index, 1);
        }
      }
    });
    
    this.workers.push({
      worker,
      busy: false,
    });
  }

  /**
   * Get an available worker
   */
  getAvailableWorker() {
    return this.workers.find(w => !w.busy);
  }

  /**
   * Process the queue of pending tasks
   */
  processQueue() {
    if (this.queue.length === 0) return;
    
    const availableWorker = this.getAvailableWorker();
    if (!availableWorker) return;
    
    const task = this.queue.shift();
    availableWorker.busy = true;
    
    availableWorker.worker.postMessage({
      id: task.id,
      target: task.target,
    });
  }

  /**
   * Execute a ping task using the worker pool
   */
  async execute(target) {
    if (!this.initialized) {
      this.initialize();
    }
    
    return new Promise((resolve, reject) => {
      const taskId = ++this.taskIdCounter;
      
      const task = {
        id: taskId,
        target,
        resolve,
        reject,
      };
      
      const availableWorker = this.getAvailableWorker();
      
      if (availableWorker) {
        availableWorker.busy = true;
        this.activeTasks.set(taskId, task);
        
        availableWorker.worker.postMessage({
          id: taskId,
          target,
        });
      } else {
        // No available worker, add to queue
        this.queue.push(task);
      }
    });
  }

  /**
   * Execute multiple pings concurrently
   */
  async executeBatch(targets) {
    const promises = targets.map(target => this.execute(target));
    return Promise.all(promises);
  }

  /**
   * Shutdown all workers
   */
  async shutdown() {
    const shutdownPromises = this.workers.map(({ worker }) => {
      return worker.terminate();
    });
    
    await Promise.all(shutdownPromises);
    this.workers = [];
    this.queue = [];
    this.activeTasks.clear();
    this.initialized = false;
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      totalWorkers: this.workers.length,
      busyWorkers: this.workers.filter(w => w.busy).length,
      queueLength: this.queue.length,
      activeTasks: this.activeTasks.size,
    };
  }
}

// Create a singleton instance
// Use optimal pool size based on CPU cores, but cap at 8 to avoid overhead
const optimalSize = Math.min(Math.max(require('os').cpus().length, 2), 8);
const workerPool = new WorkerPool(optimalSize);

module.exports = workerPool;

