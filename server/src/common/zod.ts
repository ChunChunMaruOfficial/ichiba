import { BadRequestException, PipeTransform } from '@nestjs/common';
import { z, ZodType } from 'zod';

/** Validates a request body/query against a zod schema; errors map to { field: message }. */
export class ZodPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    throw new BadRequestException({ message: 'Проверьте поля формы', fields });
  }
}
