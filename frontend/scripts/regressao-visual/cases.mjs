// Casos de teste da regressão visual -- um por família/variante em uso.
// String de teste fixa (título e corpo): cobre til, agudo, crase, cedilha,
// circunflexo minúsculo e circunflexo em maiúscula acentuada.
export const TEST_STRING =
  'Você, três, câmera, pôr, Coerência, Gestão, após, coração, ÊXITO, ÂNIMO, PÔR'

export const CASES = [
  {
    slug: 'alerta-terracota',
    rowLabel: 'Alerta terracota',
    family: 'alerta',
    variant: 'carousel',
    ideiaTone: 'verde',
    index: 1,
    total: 1,
    isCover: false,
    label: 'GAP DA COERÊNCIA',
  },
  {
    slug: 'diagnostico-verde-conteudo',
    rowLabel: 'Diagnóstico verde (conteúdo)',
    family: 'diagnostico',
    variant: 'carousel',
    ideiaTone: 'verde',
    index: 2,
    total: 3,
    isCover: false,
  },
  {
    slug: 'diagnostico-verde-capa',
    rowLabel: 'Diagnóstico verde (capa de carrossel)',
    family: 'diagnostico',
    variant: 'carousel',
    ideiaTone: 'verde',
    index: 1,
    total: 3,
    isCover: true,
  },
  {
    slug: 'dado-creme',
    rowLabel: 'Dado creme',
    family: 'dado',
    variant: 'carousel',
    ideiaTone: 'verde',
    index: 1,
    total: 1,
    isCover: false,
  },
  {
    slug: 'ideia-verde',
    rowLabel: 'Ideia verde',
    family: 'ideia',
    variant: 'quote',
    ideiaTone: 'verde',
    index: 1,
    total: 1,
    isCover: true,
  },
  {
    slug: 'ideia-terracota',
    rowLabel: 'Ideia terracota',
    family: 'ideia',
    variant: 'quote',
    ideiaTone: 'terracota',
    index: 1,
    total: 1,
    isCover: true,
  },
]
