import { isRecord } from '../model-types.ts';

/** The v2 index of shipped modules. Optional metadata describes searchable library tiles. */
export interface LibraryItem {
  file: string;
  name: string;
  ratio?: string;
  cents?: number;
  family?: string;
  tags?: string[];
}

export interface LibrarySection {
  id: string;
  label: string;
  items: LibraryItem[];
}

export interface LibraryManifest {
  version: 2;
  sections: LibrarySection[];
}

function isItem(value: unknown): value is LibraryItem {
  return isRecord(value) && typeof value.file === 'string' && typeof value.name === 'string'
    && (value.ratio === undefined || typeof value.ratio === 'string')
    && (value.cents === undefined || typeof value.cents === 'number')
    && (value.family === undefined || typeof value.family === 'string')
    && (value.tags === undefined || (Array.isArray(value.tags) && value.tags.every(tag => typeof tag === 'string')));
}

export function isLibraryManifest(value: unknown): value is LibraryManifest {
  return isRecord(value) && value.version === 2 && Array.isArray(value.sections)
    && value.sections.every((section: unknown) => isRecord(section)
      && typeof section.id === 'string' && typeof section.label === 'string'
      && Array.isArray(section.items) && section.items.every(isItem));
}
