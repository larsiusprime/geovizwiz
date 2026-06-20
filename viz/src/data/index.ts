/**
 * Repository factory. Returns the singleton DataRepository appropriate for the
 * current runtime mode. The renderer should obtain its repository through here
 * rather than constructing one directly.
 */

import { isDesktopMode } from '../runtime-mode.js';
import type { DataRepository } from './repository.js';
import { InMemoryRepository } from './in-memory-repository.js';
import { DesktopRepository } from './desktop-repository.js';

let instance: DataRepository | null = null;

export function getRepository(): DataRepository {
  if (instance) return instance;
  instance = isDesktopMode() ? new DesktopRepository() : new InMemoryRepository();
  return instance;
}

export type { DataRepository } from './repository.js';
export type { BBox, SourceInfo, GeometryQueryOptions, FieldStats } from './repository.js';
