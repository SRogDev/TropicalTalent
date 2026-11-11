-- ============================================================
-- Migration: future project setup - tasks, resources, metrics
-- These tables depend on the projects table (create_projects_and_project_messages.sql)
-- Run AFTER the projects migration.
-- ============================================================

BEGIN;

-- ===========================
-- TABLE: project_tasks
-- ===========================
CREATE TABLE IF NOT EXISTS public.project_tasks (
  id           uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  project_id   uuid NOT NULL,
  title        text NOT NULL,
  description  text,
  status       text DEFAULT 'todo' CHECK (status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'done'::text, 'blocked'::text])),
  priority     text DEFAULT 'medium' CHECK (priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text])),
  assignee_id  uuid,                          -- member of the project assigned to this task
  due_date     timestamptz,
  created_by   uuid NOT NULL,

  CONSTRAINT project_tasks_pkey PRIMARY KEY (id),
  CONSTRAINT project_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  CONSTRAINT project_tasks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT project_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.project_tasks IS 'Tasks within a project. Members can be assigned tasks by brand owner.';

-- ===========================
-- TABLE: project_resources
-- ===========================
-- Documentation stored per project (text, links, or uploaded files)
CREATE TABLE IF NOT EXISTS public.project_resources (
  id           uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  project_id   uuid NOT NULL,
  title        text NOT NULL,
  type         text DEFAULT 'document' CHECK (type = ANY (ARRAY['document'::text, 'link'::text, 'note'::text, 'file'::text])),
  content      text,                          -- For notes/links/text content
  file_url     text,                          -- For uploaded files
  file_name    text,
  file_size    bigint,
  mime_type    text,
  created_by   uuid NOT NULL,

  CONSTRAINT project_resources_pkey PRIMARY KEY (id),
  CONSTRAINT project_resources_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  CONSTRAINT project_resources_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.project_resources IS 'Documentation and resources for a project. Used by AI context and quick team access.';

-- ===========================
-- TABLE: project_metrics
-- ===========================
-- Periodic snapshots of project health / KPIs
CREATE TABLE IF NOT EXISTS public.project_metrics (
  id           uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at   timestamptz DEFAULT now(),
  project_id   uuid NOT NULL,
  messages_count    integer DEFAULT 0,
  tasks_total       integer DEFAULT 0,
  tasks_completed   integer DEFAULT 0,
  members_count     integer DEFAULT 0,
  resources_count   integer DEFAULT 0,
  recorded_at       timestamptz DEFAULT now(),

  CONSTRAINT project_metrics_pkey PRIMARY KEY (id),
  CONSTRAINT project_metrics_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.project_metrics IS 'Periodic snapshots of project activity metrics for dashboards.';

-- ===========================
-- INDEXES
-- ===========================
CREATE INDEX IF NOT EXISTS idx_project_tasks_project_id ON public.project_tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_assignee_id ON public.project_tasks (assignee_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_status ON public.project_tasks (project_id, status);
CREATE INDEX IF NOT EXISTS idx_project_resources_project_id ON public.project_resources (project_id);
CREATE INDEX IF NOT EXISTS idx_project_metrics_project_id ON public.project_metrics (project_id, recorded_at DESC);

-- ===========================
-- RLS
-- ===========================
ALTER TABLE public.project_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_metrics ENABLE ROW LEVEL SECURITY;

-- Tasks: all project members can view
CREATE POLICY "members_can_view_tasks"
  ON public.project_tasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_id AND pm.user_id = auth.uid()
    )
  );

-- Tasks: brand owner or admin can manage
CREATE POLICY "brand_owner_can_manage_tasks"
  ON public.project_tasks FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND (p.brand_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
    )
  );

-- Resources: all project members can view
CREATE POLICY "members_can_view_resources"
  ON public.project_resources FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_id AND pm.user_id = auth.uid()
    )
  );

-- Resources: brand owner or admin can manage
CREATE POLICY "brand_owner_can_manage_resources"
  ON public.project_resources FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND (p.brand_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
    )
  );

-- Metrics: all project members can view
CREATE POLICY "members_can_view_metrics"
  ON public.project_metrics FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_id AND pm.user_id = auth.uid()
    )
  );

COMMIT;
