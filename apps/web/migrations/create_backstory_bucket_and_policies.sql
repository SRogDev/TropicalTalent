-- Migration: Create user_backstories bucket and policies, one PDF per user, and create user folders
-- Date: 2026-01-22

-- ============================================
-- PART 1: Crear bucket 'user_backstories' (manual en dashboard)
-- ============================================
-- 1. Crear el bucket 'user_backstories' en Supabase Storage (público, 50MB)
--    (Esto se hace desde el dashboard, pero aquí van las políticas SQL)

-- ============================================
-- PART 2: Políticas de acceso para el bucket 'user_backstories'
-- ============================================

-- Permitir lectura pública de todos los archivos en el bucket user_backstories
CREATE POLICY "Public read access for user_backstories"
ON storage.objects FOR SELECT
USING (bucket_id = 'user_backstories');

-- Permitir a cada usuario subir solo un PDF a su propia carpeta (user_id/)
CREATE POLICY "Users can upload one PDF to their own folder in user_backstories"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'user_backstories'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND lower(right(name, 4)) = '.pdf'
  AND (
    SELECT count(*) = 0 FROM storage.objects
    WHERE bucket_id = 'user_backstories'
      AND name LIKE auth.uid()::text || '/%.pdf'
  )
);

-- Permitir a cada usuario borrar solo su propio PDF
CREATE POLICY "Users can delete their own PDF in user_backstories"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'user_backstories'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND lower(right(name, 4)) = '.pdf'
);

-- (Opcional) Prevenir updates directos
REVOKE UPDATE ON storage.objects FROM PUBLIC;

-- ============================================
-- PART 3: Crear carpetas para cada usuario existente
-- ============================================
-- Esto crea un archivo vacío ".keep" en cada carpeta de usuario para forzar la creación de la carpeta
DO $$
DECLARE
  u RECORD;
BEGIN
  FOR u IN SELECT id FROM public.users LOOP
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('user_backstories', u.id::text || '/.keep', u.id)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ============================================
-- FIN DEL SCRIPT
