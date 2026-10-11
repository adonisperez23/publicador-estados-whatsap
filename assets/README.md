# assets/ — Imágenes de los platos (Principio III, FR-005, FR-006)

- Cada plato de `menu.json` MUST tener su imagen **físicamente presente** en esta
  carpeta: el campo `image` es el nombre del archivo dentro de `assets/`.
- El vínculo imagen↔texto es **exclusivamente por `id`** de plato en `menu.json`
  (nunca por nombre de plato ni por orden de aparición). Vínculo ambiguo o
  faltante = `config-invalida` que bloquea la publicación.
- Validación **por intento** antes de publicar: la imagen debe existir, ser
  legible y tener tamaño > 0; si falla, se omite con motivo `imagen-faltante`
  y el resto de las publicaciones continúan (SC-003).
- Formatos habituales de imagen (jpg/png/webp) con calidad apta para Estados;
  prepare las imágenes con antelación (Assumptions del spec).

Ejemplos incluidos: `ensalada.png`, `pasta.png` (placeholders para el arranque).
Reemplácelas por fotos reales de los platos del negocio.
