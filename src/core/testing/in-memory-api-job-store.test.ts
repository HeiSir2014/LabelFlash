import { describeApiJobStore } from './api-job-store-contract';
import { InMemoryApiJobStore } from './in-memory-api-job-store';

describeApiJobStore('InMemoryApiJobStore', () => new InMemoryApiJobStore());
