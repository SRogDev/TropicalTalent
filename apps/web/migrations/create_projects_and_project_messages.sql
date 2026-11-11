-- ============================================================
-- Migration: create projects table + project_messages table
-- Core tables needed for the Project Management feature
-- ============================================================

BEGIN;

-- ===========================
-- TABLE: projects
-- ===========================
CREATE TABLE IF NOT EXISTS public.projects (
  id           uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  name         text NOT NULL,
  description  text,
  brand_id     uuid NOT NULL,                -- The owning brand user (can be overridden when admin sets Brand member)
  total_members integer DEFAULT 1,
  budget       numeric,
  status       text DEFAULT 'active' CHECK (status = ANY (ARRAY['active'::text, 'archived'::text, 'completed'::text])),

  CONSTRAINT projects_pkey PRIMARY KEY (id),
  CONSTRAINT projects_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.projects IS 'Brand project management - groups members, chat, tasks and resources';

-- ===========================
-- TABLE: project_members
-- ===========================
-- Tracks which users belong to a project and their in-project role
CREATE TABLE IF NOT EXISTS public.project_members (
  id           uuid DEFAULT gen_random_uuid() NOT NULL,
  project_id   uuid NOT NULL,
  user_id      uuid NOT NULL,
  role         text DEFAULT 'member' CHECK (role = ANY (ARRAY['owner'::text, 'brand'::text, 'member'::text])),
  joined_at    timestamptz DEFAULT now(),

  CONSTRAINT project_members_pkey PRIMARY KEY (id),
  CONSTRAINT project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  CONSTRAINT project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT project_members_project_user_unique UNIQUE (project_id, user_id)
);

COMMENT ON TABLE public.project_members IS 'Members of each project. role=brand means this user is the brand owner of the project (updates projects.brand_id)';

-- ===========================
-- TABLE: project_messages
-- ===========================
-- Separate from 1-to-1 messages table. Group chat per project.
CREATE TABLE IF NOT EXISTS public.project_messages (
  id           uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  project_id   uuid NOT NULL,
  sender_id    uuid NOT NULL,
  content      jsonb NOT NULL,
  type         text DEFAULT 'text' CHECK (type = ANY (ARRAY['text'::text, 'image'::text, 'document'::text])),

  CONSTRAINT project_messages_pkey PRIMARY KEY (id),
  CONSTRAINT project_messages_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  CONSTRAINT project_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.project_messages IS 'Realtime group chat messages per project. Separate from 1-to-1 messages.';

-- ===========================
-- INDEXES
-- ===========================
CREATE INDEX IF NOT EXISTS idx_projects_brand_id ON public.projects (brand_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON public.project_members (project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON public.project_members (user_id);
CREATE INDEX IF NOT EXISTS idx_project_messages_project_id ON public.project_messages (project_id);
CREATE INDEX IF NOT EXISTS idx_project_messages_created_at ON public.project_messages (project_id, created_at ASC);

-- ===========================
-- RLS (Row Level Security)
-- ===========================
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_messages ENABLE ROW LEVEL SECURITY;

-- Projects: visible to members of the project
CREATE POLICY "project_members_can_view"
  ON public.projects FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = id AND pm.user_id = auth.uid()
    )
  );

-- Projects: brand owners (and admins) can insert
CREATE POLICY "brand_can_create_projects"
  ON public.projects FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('brand', 'admin')
    )
  );

-- Projects: only brand_id owner or admin can update
CREATE POLICY "brand_owner_can_update_project"
  ON public.projects FOR UPDATE
  USING (
    brand_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

-- Project members: members can view own membership list
CREATE POLICY "members_can_view_project_members"
  ON public.project_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_id AND pm.user_id = auth.uid()
    )
  );

-- Project members: project brand_id or admin can manage members
CREATE POLICY "brand_owner_can_manage_members"
  ON public.project_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND (p.brand_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
    )
  );

-- Project messages: only members can read
CREATE POLICY "members_can_read_project_messages"
  ON public.project_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_id AND pm.user_id = auth.uid()
    )
  );

-- Project messages: only members can send
CREATE POLICY "members_can_send_project_messages"
  ON public.project_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_id AND pm.user_id = auth.uid()
    )
  );

-- ===========================
-- Realtime for project_messages
-- ===========================
-- Enable realtime replication for project messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_messages;

COMMIT;
