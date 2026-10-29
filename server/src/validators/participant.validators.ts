import { z } from 'zod';

// Nome completo obrigatório: pelo menos nome e sobrenome (duas palavras com 2+ letras).
const NAME_CHARS = /^[\p{L}][\p{L}\p{M}'’.\- ]*$/u;

export const fullNameSchema = z
  .string({ required_error: 'Informe seu nome completo.' })
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(5, 'Informe seu nome completo (nome e sobrenome).')
      .max(160, 'O nome deve ter no máximo 160 caracteres.')
      .regex(NAME_CHARS, 'Use apenas letras no nome.')
      .refine(
        (value) =>
          value.split(' ').filter((part) => part.replace(/[^\p{L}]/gu, '').length >= 2)
            .length >= 2,
        'Informe nome e sobrenome.',
      ),
  );

export const enterSchema = z.object({
  fullName: fullNameSchema,
  // Segunda etapa, quando o servidor encontrou um perfil recente (mesmo nome e IP).
  decision: z.enum(['resume', 'new']).optional(),
});

export type EnterInput = z.infer<typeof enterSchema>;
