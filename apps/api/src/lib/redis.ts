import Redis from 'ioredis';
import { CONFIG } from '../config';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(CONFIG.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
  }
  return redisClient;
}

