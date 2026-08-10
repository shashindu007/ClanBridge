// Generated from the live Supabase schema by `npm run types:db`.
// DO NOT EDIT. Regenerate after every migration — a stale file type-checks
// against a schema that no longer exists, which is worse than having none.
//
// 32 tables, generated 2026-08-10.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      announcements: {
        Row: {
          id: string;
          clan_id: string;
          author_id: string;
          title: string;
          body: string;
          pinned: boolean;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          clan_id: string;
          author_id: string;
          title: string;
          body: string;
          pinned?: boolean;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          clan_id?: string;
          author_id?: string;
          title?: string;
          body?: string;
          pinned?: boolean;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      audit_log: {
        Row: {
          id: string;
          user_id: string | null;
          clan_id: string | null;
          action: string;
          entity: string;
          entity_id: string | null;
          before: Json | null;
          after: Json | null;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          clan_id?: string | null;
          action: string;
          entity: string;
          entity_id?: string | null;
          before?: Json | null;
          after?: Json | null;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          clan_id?: string | null;
          action?: string;
          entity?: string;
          entity_id?: string | null;
          before?: Json | null;
          after?: Json | null;
          created_at?: string;
          deleted_at?: string | null;
        };
      };
      base_layouts: {
        Row: {
          id: string;
          clan_id: string;
          uploaded_by: string;
          th_level: number;
          layout_type: string;
          copy_link: string;
          image_url: string | null;
          description: string | null;
          votes: number;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          clan_id: string;
          uploaded_by: string;
          th_level: number;
          layout_type: string;
          copy_link: string;
          image_url?: string | null;
          description?: string | null;
          votes?: number;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          clan_id?: string;
          uploaded_by?: string;
          th_level?: number;
          layout_type?: string;
          copy_link?: string;
          image_url?: string | null;
          description?: string | null;
          votes?: number;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      clan_games: {
        Row: {
          id: string;
          clan_id: string;
          season: string;
          start_time: string | null;
          end_time: string | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
          settled_at: string | null;
        };
        Insert: {
          id?: string;
          clan_id: string;
          season: string;
          start_time?: string | null;
          end_time?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          settled_at?: string | null;
        };
        Update: {
          id?: string;
          clan_id?: string;
          season?: string;
          start_time?: string | null;
          end_time?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          settled_at?: string | null;
        };
      };
      clan_games_scores: {
        Row: {
          id: string;
          clan_games_id: string;
          player_id: string;
          points: number | null;
          start_value: number | null;
          end_value: number | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          clan_games_id: string;
          player_id: string;
          points?: number | null;
          start_value?: number | null;
          end_value?: number | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          clan_games_id?: string;
          player_id?: string;
          points?: number | null;
          start_value?: number | null;
          end_value?: number | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      clan_roles: {
        Row: {
          id: string;
          user_id: string;
          clan_id: string;
          role: string;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          clan_id: string;
          role: string;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          clan_id?: string;
          role?: string;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      clans: {
        Row: {
          id: string;
          tag: string;
          name: string;
          badge_url: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
          level: number | null;
          war_league: string | null;
          member_count: number | null;
          is_war_log_public: boolean | null;
        };
        Insert: {
          id?: string;
          tag: string;
          name: string;
          badge_url?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          level?: number | null;
          war_league?: string | null;
          member_count?: number | null;
          is_war_log_public?: boolean | null;
        };
        Update: {
          id?: string;
          tag?: string;
          name?: string;
          badge_url?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          level?: number | null;
          war_league?: string | null;
          member_count?: number | null;
          is_war_log_public?: boolean | null;
        };
      };
      cwl_attacks: {
        Row: {
          id: string;
          war_id: string;
          player_id: string;
          attack_order: number;
          stars: number;
          destruction: number;
          defender_tag: string | null;
          defender_position: number | null;
          attacked_at: string | null;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          war_id: string;
          player_id: string;
          attack_order?: number;
          stars: number;
          destruction: number;
          defender_tag?: string | null;
          defender_position?: number | null;
          attacked_at?: string | null;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          war_id?: string;
          player_id?: string;
          attack_order?: number;
          stars?: number;
          destruction?: number;
          defender_tag?: string | null;
          defender_position?: number | null;
          attacked_at?: string | null;
          created_at?: string;
          deleted_at?: string | null;
        };
      };
      cwl_bonuses: {
        Row: {
          id: string;
          season_id: string;
          player_id: string;
          awarded_by: string;
          awarded_at: string;
          note: string | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
          award_order: number | null;
        };
        Insert: {
          id?: string;
          season_id: string;
          player_id: string;
          awarded_by: string;
          awarded_at?: string;
          note?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          award_order?: number | null;
        };
        Update: {
          id?: string;
          season_id?: string;
          player_id?: string;
          awarded_by?: string;
          awarded_at?: string;
          note?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          award_order?: number | null;
        };
      };
      cwl_roster_members: {
        Row: {
          id: string;
          roster_id: string;
          player_id: string;
          position: number | null;
          added_by: string;
          added_at: string;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          roster_id: string;
          player_id: string;
          position?: number | null;
          added_by: string;
          added_at?: string;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          roster_id?: string;
          player_id?: string;
          position?: number | null;
          added_by?: string;
          added_at?: string;
          created_at?: string;
          deleted_at?: string | null;
        };
      };
      cwl_rosters: {
        Row: {
          id: string;
          season: string;
          clan_id: string;
          status: string;
          slot_count: number;
          created_by: string;
          published_at: string | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          season: string;
          clan_id: string;
          status?: string;
          slot_count?: number;
          created_by: string;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          season?: string;
          clan_id?: string;
          status?: string;
          slot_count?: number;
          created_by?: string;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      cwl_seasons: {
        Row: {
          id: string;
          clan_id: string;
          season: string;
          league: string | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          clan_id: string;
          season: string;
          league?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          clan_id?: string;
          season?: string;
          league?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      cwl_war_members: {
        Row: {
          id: string;
          war_id: string;
          player_id: string;
          map_position: number | null;
          th_level: number | null;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          war_id: string;
          player_id: string;
          map_position?: number | null;
          th_level?: number | null;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          war_id?: string;
          player_id?: string;
          map_position?: number | null;
          th_level?: number | null;
          created_at?: string;
          deleted_at?: string | null;
        };
      };
      cwl_wars: {
        Row: {
          id: string;
          season_id: string;
          war_tag: string;
          day_number: number | null;
          opponent_tag: string | null;
          opponent_name: string | null;
          team_size: number | null;
          state: string | null;
          our_stars: number | null;
          their_stars: number | null;
          our_destruction: number | null;
          their_destruction: number | null;
          result: string | null;
          start_time: string | null;
          end_time: string | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          season_id: string;
          war_tag: string;
          day_number?: number | null;
          opponent_tag?: string | null;
          opponent_name?: string | null;
          team_size?: number | null;
          state?: string | null;
          our_stars?: number | null;
          their_stars?: number | null;
          our_destruction?: number | null;
          their_destruction?: number | null;
          result?: string | null;
          start_time?: string | null;
          end_time?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          season_id?: string;
          war_tag?: string;
          day_number?: number | null;
          opponent_tag?: string | null;
          opponent_name?: string | null;
          team_size?: number | null;
          state?: string | null;
          our_stars?: number | null;
          their_stars?: number | null;
          our_destruction?: number | null;
          their_destruction?: number | null;
          result?: string | null;
          start_time?: string | null;
          end_time?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      member_snapshots: {
        Row: {
          id: string;
          clan_id: string;
          player_id: string;
          captured_at: string;
          donations: number | null;
          donations_received: number | null;
          trophies: number | null;
          war_stars: number | null;
          th_level: number | null;
          role: string | null;
          created_at: string;
          deleted_at: string | null;
          captured_hour: string | null;
        };
        Insert: {
          id?: string;
          clan_id: string;
          player_id: string;
          captured_at?: string;
          donations?: number | null;
          donations_received?: number | null;
          trophies?: number | null;
          war_stars?: number | null;
          th_level?: number | null;
          role?: string | null;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          clan_id?: string;
          player_id?: string;
          captured_at?: string;
          donations?: number | null;
          donations_received?: number | null;
          trophies?: number | null;
          war_stars?: number | null;
          th_level?: number | null;
          role?: string | null;
          created_at?: string;
          deleted_at?: string | null;
        };
      };
      notification_preferences: {
        Row: {
          id: string;
          user_id: string;
          announcements: boolean;
          cwl_reminders: boolean;
          war_reminders: boolean;
          raid_reminders: boolean;
          poll_reminders: boolean;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          announcements?: boolean;
          cwl_reminders?: boolean;
          war_reminders?: boolean;
          raid_reminders?: boolean;
          poll_reminders?: boolean;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          announcements?: boolean;
          cwl_reminders?: boolean;
          war_reminders?: boolean;
          raid_reminders?: boolean;
          poll_reminders?: boolean;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      players: {
        Row: {
          id: string;
          clan_id: string | null;
          user_id: string | null;
          tag: string;
          name: string;
          th_level: number | null;
          verified: boolean;
          clan_role: string | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
          left_at: string | null;
        };
        Insert: {
          id?: string;
          clan_id?: string | null;
          user_id?: string | null;
          tag: string;
          name: string;
          th_level?: number | null;
          verified?: boolean;
          clan_role?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          left_at?: string | null;
        };
        Update: {
          id?: string;
          clan_id?: string | null;
          user_id?: string | null;
          tag?: string;
          name?: string;
          th_level?: number | null;
          verified?: boolean;
          clan_role?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          left_at?: string | null;
        };
      };
      poll_options: {
        Row: {
          id: string;
          poll_id: string;
          label: string;
          sort_order: number;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          poll_id: string;
          label: string;
          sort_order?: number;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          poll_id?: string;
          label?: string;
          sort_order?: number;
          created_at?: string;
          deleted_at?: string | null;
        };
      };
      poll_responses: {
        Row: {
          id: string;
          poll_id: string;
          player_id: string;
          option_id: string;
          note: string | null;
          responded_at: string;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          poll_id: string;
          player_id: string;
          option_id: string;
          note?: string | null;
          responded_at?: string;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          poll_id?: string;
          player_id?: string;
          option_id?: string;
          note?: string | null;
          responded_at?: string;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      polls: {
        Row: {
          id: string;
          scope: string;
          clan_id: string | null;
          season: string | null;
          poll_type: string;
          title: string;
          question: string | null;
          opens_at: string | null;
          closes_at: string | null;
          status: string;
          created_by: string;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          scope: string;
          clan_id?: string | null;
          season?: string | null;
          poll_type: string;
          title: string;
          question?: string | null;
          opens_at?: string | null;
          closes_at?: string | null;
          status?: string;
          created_by: string;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          scope?: string;
          clan_id?: string | null;
          season?: string | null;
          poll_type?: string;
          title?: string;
          question?: string | null;
          opens_at?: string | null;
          closes_at?: string | null;
          status?: string;
          created_by?: string;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      raid_participants: {
        Row: {
          id: string;
          raid_season_id: string;
          player_id: string;
          attacks_used: number | null;
          loot: number | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
          attack_limit: number | null;
          bonus_attack_limit: number | null;
        };
        Insert: {
          id?: string;
          raid_season_id: string;
          player_id: string;
          attacks_used?: number | null;
          loot?: number | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          attack_limit?: number | null;
          bonus_attack_limit?: number | null;
        };
        Update: {
          id?: string;
          raid_season_id?: string;
          player_id?: string;
          attacks_used?: number | null;
          loot?: number | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          attack_limit?: number | null;
          bonus_attack_limit?: number | null;
        };
      };
      raid_seasons: {
        Row: {
          id: string;
          clan_id: string;
          start_time: string;
          end_time: string | null;
          total_loot: number | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
          state: string | null;
          raids_completed: number | null;
          total_attacks: number | null;
          offensive_reward: number | null;
          defensive_reward: number | null;
        };
        Insert: {
          id?: string;
          clan_id: string;
          start_time: string;
          end_time?: string | null;
          total_loot?: number | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          state?: string | null;
          raids_completed?: number | null;
          total_attacks?: number | null;
          offensive_reward?: number | null;
          defensive_reward?: number | null;
        };
        Update: {
          id?: string;
          clan_id?: string;
          start_time?: string;
          end_time?: string | null;
          total_loot?: number | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          state?: string | null;
          raids_completed?: number | null;
          total_attacks?: number | null;
          offensive_reward?: number | null;
          defensive_reward?: number | null;
        };
      };
      sync_log: {
        Row: {
          id: string;
          job_type: string;
          clan_id: string | null;
          started_at: string;
          finished_at: string | null;
          status: string;
          skip_reason: string | null;
          error: string | null;
          records_written: number | null;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          job_type: string;
          clan_id?: string | null;
          started_at?: string;
          finished_at?: string | null;
          status: string;
          skip_reason?: string | null;
          error?: string | null;
          records_written?: number | null;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          job_type?: string;
          clan_id?: string | null;
          started_at?: string;
          finished_at?: string | null;
          status?: string;
          skip_reason?: string | null;
          error?: string | null;
          records_written?: number | null;
          created_at?: string;
          deleted_at?: string | null;
        };
      };
      users: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
          status: string;
          requested_clan_id: string | null;
          approved_by: string | null;
          approved_at: string | null;
          is_platform_admin: boolean;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          status?: string;
          requested_clan_id?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
          is_platform_admin?: boolean;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          status?: string;
          requested_clan_id?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
          is_platform_admin?: boolean;
        };
      };
      war_attacks: {
        Row: {
          id: string;
          war_id: string;
          player_id: string;
          attack_order: number;
          stars: number;
          destruction: number;
          defender_tag: string | null;
          defender_position: number | null;
          attacked_at: string | null;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          war_id: string;
          player_id: string;
          attack_order: number;
          stars: number;
          destruction: number;
          defender_tag?: string | null;
          defender_position?: number | null;
          attacked_at?: string | null;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          war_id?: string;
          player_id?: string;
          attack_order?: number;
          stars?: number;
          destruction?: number;
          defender_tag?: string | null;
          defender_position?: number | null;
          attacked_at?: string | null;
          created_at?: string;
          deleted_at?: string | null;
        };
      };
      war_lineup_members: {
        Row: {
          id: string;
          lineup_id: string;
          player_id: string;
          position: number | null;
          added_by: string;
          added_at: string;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          lineup_id: string;
          player_id: string;
          position?: number | null;
          added_by: string;
          added_at?: string;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          lineup_id?: string;
          player_id?: string;
          position?: number | null;
          added_by?: string;
          added_at?: string;
          created_at?: string;
          deleted_at?: string | null;
        };
      };
      war_lineups: {
        Row: {
          id: string;
          clan_id: string;
          planned_for: string;
          size: number;
          status: string;
          war_id: string | null;
          created_by: string;
          published_at: string | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          clan_id: string;
          planned_for?: string;
          size: number;
          status?: string;
          war_id?: string | null;
          created_by: string;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          clan_id?: string;
          planned_for?: string;
          size?: number;
          status?: string;
          war_id?: string | null;
          created_by?: string;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      war_members: {
        Row: {
          id: string;
          war_id: string;
          player_id: string;
          map_position: number | null;
          th_level: number | null;
          attacks_allowed: number;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          war_id: string;
          player_id: string;
          map_position?: number | null;
          th_level?: number | null;
          attacks_allowed?: number;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          war_id?: string;
          player_id?: string;
          map_position?: number | null;
          th_level?: number | null;
          attacks_allowed?: number;
          created_at?: string;
          deleted_at?: string | null;
        };
      };
      war_opponent_members: {
        Row: {
          id: string;
          war_id: string;
          tag: string;
          name: string | null;
          map_position: number | null;
          th_level: number | null;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          war_id: string;
          tag: string;
          name?: string | null;
          map_position?: number | null;
          th_level?: number | null;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          war_id?: string;
          tag?: string;
          name?: string | null;
          map_position?: number | null;
          th_level?: number | null;
          created_at?: string;
          deleted_at?: string | null;
        };
      };
      war_targets: {
        Row: {
          id: string;
          war_id: string;
          player_id: string;
          target_position: number;
          note: string | null;
          assigned_by: string | null;
          assigned_at: string;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          war_id: string;
          player_id: string;
          target_position: number;
          note?: string | null;
          assigned_by?: string | null;
          assigned_at?: string;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          war_id?: string;
          player_id?: string;
          target_position?: number;
          note?: string | null;
          assigned_by?: string | null;
          assigned_at?: string;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      wars: {
        Row: {
          id: string;
          clan_id: string;
          opponent_tag: string | null;
          opponent_name: string | null;
          team_size: number | null;
          state: string | null;
          our_stars: number | null;
          their_stars: number | null;
          our_destruction: number | null;
          their_destruction: number | null;
          result: string | null;
          start_time: string;
          end_time: string | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          clan_id: string;
          opponent_tag?: string | null;
          opponent_name?: string | null;
          team_size?: number | null;
          state?: string | null;
          our_stars?: number | null;
          their_stars?: number | null;
          our_destruction?: number | null;
          their_destruction?: number | null;
          result?: string | null;
          start_time: string;
          end_time?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          clan_id?: string;
          opponent_tag?: string | null;
          opponent_name?: string | null;
          team_size?: number | null;
          state?: string | null;
          our_stars?: number | null;
          their_stars?: number | null;
          our_destruction?: number | null;
          their_destruction?: number | null;
          result?: string | null;
          start_time?: string;
          end_time?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
    };
  };
}

// Row aliases.
export type AnnouncementsRow = Database["public"]["Tables"]["announcements"]["Row"];
export type AuditLogRow = Database["public"]["Tables"]["audit_log"]["Row"];
export type BaseLayoutsRow = Database["public"]["Tables"]["base_layouts"]["Row"];
export type ClanGamesRow = Database["public"]["Tables"]["clan_games"]["Row"];
export type ClanGamesScoresRow = Database["public"]["Tables"]["clan_games_scores"]["Row"];
export type ClanRolesRow = Database["public"]["Tables"]["clan_roles"]["Row"];
export type ClansRow = Database["public"]["Tables"]["clans"]["Row"];
export type CwlAttacksRow = Database["public"]["Tables"]["cwl_attacks"]["Row"];
export type CwlBonusesRow = Database["public"]["Tables"]["cwl_bonuses"]["Row"];
export type CwlRosterMembersRow = Database["public"]["Tables"]["cwl_roster_members"]["Row"];
export type CwlRostersRow = Database["public"]["Tables"]["cwl_rosters"]["Row"];
export type CwlSeasonsRow = Database["public"]["Tables"]["cwl_seasons"]["Row"];
export type CwlWarMembersRow = Database["public"]["Tables"]["cwl_war_members"]["Row"];
export type CwlWarsRow = Database["public"]["Tables"]["cwl_wars"]["Row"];
export type MemberSnapshotsRow = Database["public"]["Tables"]["member_snapshots"]["Row"];
export type NotificationPreferencesRow = Database["public"]["Tables"]["notification_preferences"]["Row"];
export type PlayersRow = Database["public"]["Tables"]["players"]["Row"];
export type PollOptionsRow = Database["public"]["Tables"]["poll_options"]["Row"];
export type PollResponsesRow = Database["public"]["Tables"]["poll_responses"]["Row"];
export type PollsRow = Database["public"]["Tables"]["polls"]["Row"];
export type PushSubscriptionsRow = Database["public"]["Tables"]["push_subscriptions"]["Row"];
export type RaidParticipantsRow = Database["public"]["Tables"]["raid_participants"]["Row"];
export type RaidSeasonsRow = Database["public"]["Tables"]["raid_seasons"]["Row"];
export type SyncLogRow = Database["public"]["Tables"]["sync_log"]["Row"];
export type UsersRow = Database["public"]["Tables"]["users"]["Row"];
export type WarAttacksRow = Database["public"]["Tables"]["war_attacks"]["Row"];
export type WarLineupMembersRow = Database["public"]["Tables"]["war_lineup_members"]["Row"];
export type WarLineupsRow = Database["public"]["Tables"]["war_lineups"]["Row"];
export type WarMembersRow = Database["public"]["Tables"]["war_members"]["Row"];
export type WarOpponentMembersRow = Database["public"]["Tables"]["war_opponent_members"]["Row"];
export type WarTargetsRow = Database["public"]["Tables"]["war_targets"]["Row"];
export type WarsRow = Database["public"]["Tables"]["wars"]["Row"];
