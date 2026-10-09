import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * The one class-name helper. `clsx` flattens conditionals; `tailwind-merge`
 * resolves conflicts so the LAST conflicting utility wins, which makes a
 * caller's `className` a real override. Never use one without the other.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
