-- Add missing columns to referrals table for referrer reward tracking
--
-- referrer_reward_status: tracks whether the referrer has used their free-collab reward
--   'pending'  = reward is available (referrer can do one collab with 0% creative fee)
--   'applied'  = reward has been used
--
-- referrer_reward_collaboration_id: which collaboration the reward was applied to (for auditing)

ALTER TABLE public.referrals
  ADD COLUMN IF NOT EXISTS referrer_reward_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS referrer_reward_collaboration_id uuid REFERENCES public.collaborations(id);
