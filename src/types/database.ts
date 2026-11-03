// Generated from the live Supabase schema by `npm run types:db`.
// DO NOT EDIT. Regenerate after every migration — a stale file type-checks
// against a schema that no longer exists, which is worse than having none.
//
// 52 tables, generated 2026-10-31.

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
      account_messages: {
        Row: {
          id: string;
          recipient_id: string;
          sender_id: string;
          clan_id: string | null;
          subject: string;
          body: string;
          read_at: string | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          recipient_id: string;
          sender_id: string;
          clan_id?: string | null;
          subject: string;
          body: string;
          read_at?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          recipient_id?: string;
          sender_id?: string;
          clan_id?: string | null;
          subject?: string;
          body?: string;
          read_at?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
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
      base_layout_votes: {
        Row: {
          id: string;
          layout_id: string;
          user_id: string;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          layout_id: string;
          user_id: string;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          layout_id?: string;
          user_id?: string;
          created_at?: string;
          updated_at?: string | null;
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
      clan_profiles: {
        Row: {
          id: string;
          clan_id: string;
          war_wins: number | null;
          war_ties: number | null;
          war_losses: number | null;
          war_win_streak: number | null;
          capital_league: string | null;
          capital_hall_level: number | null;
          capital_districts: Json;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
          description: string | null;
          clan_points: number | null;
          clan_builder_base_points: number | null;
          clan_capital_points: number | null;
          war_frequency: string | null;
          required_townhall_level: number | null;
          required_trophies: number | null;
          location: string | null;
          labels: Json;
        };
        Insert: {
          id?: string;
          clan_id: string;
          war_wins?: number | null;
          war_ties?: number | null;
          war_losses?: number | null;
          war_win_streak?: number | null;
          capital_league?: string | null;
          capital_hall_level?: number | null;
          capital_districts?: Json;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          description?: string | null;
          clan_points?: number | null;
          clan_builder_base_points?: number | null;
          clan_capital_points?: number | null;
          war_frequency?: string | null;
          required_townhall_level?: number | null;
          required_trophies?: number | null;
          location?: string | null;
          labels?: Json;
        };
        Update: {
          id?: string;
          clan_id?: string;
          war_wins?: number | null;
          war_ties?: number | null;
          war_losses?: number | null;
          war_win_streak?: number | null;
          capital_league?: string | null;
          capital_hall_level?: number | null;
          capital_districts?: Json;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          description?: string | null;
          clan_points?: number | null;
          clan_builder_base_points?: number | null;
          clan_capital_points?: number | null;
          war_frequency?: string | null;
          required_townhall_level?: number | null;
          required_trophies?: number | null;
          location?: string | null;
          labels?: Json;
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
      cwl_group_clans: {
        Row: {
          id: string;
          season_id: string;
          clan_tag: string;
          name: string | null;
          badge_url: string | null;
          clan_level: number | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          season_id: string;
          clan_tag: string;
          name?: string | null;
          badge_url?: string | null;
          clan_level?: number | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          season_id?: string;
          clan_tag?: string;
          name?: string | null;
          badge_url?: string | null;
          clan_level?: number | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      cwl_group_members: {
        Row: {
          id: string;
          season_id: string;
          clan_tag: string;
          tag: string;
          name: string | null;
          th_level: number | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          season_id: string;
          clan_tag: string;
          tag: string;
          name?: string | null;
          th_level?: number | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          season_id?: string;
          clan_tag?: string;
          tag?: string;
          name?: string | null;
          th_level?: number | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      cwl_group_war_members: {
        Row: {
          id: string;
          season_id: string;
          war_tag: string;
          clan_tag: string;
          tag: string;
          name: string | null;
          th_level: number | null;
          map_position: number | null;
          attack_stars: number | null;
          attack_destruction: number | null;
          attack_defender_tag: string | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
          attack_order: number | null;
        };
        Insert: {
          id?: string;
          season_id: string;
          war_tag: string;
          clan_tag: string;
          tag: string;
          name?: string | null;
          th_level?: number | null;
          map_position?: number | null;
          attack_stars?: number | null;
          attack_destruction?: number | null;
          attack_defender_tag?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          attack_order?: number | null;
        };
        Update: {
          id?: string;
          season_id?: string;
          war_tag?: string;
          clan_tag?: string;
          tag?: string;
          name?: string | null;
          th_level?: number | null;
          map_position?: number | null;
          attack_stars?: number | null;
          attack_destruction?: number | null;
          attack_defender_tag?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          attack_order?: number | null;
        };
      };
      cwl_group_wars: {
        Row: {
          id: string;
          season_id: string;
          war_tag: string;
          day_number: number | null;
          state: string | null;
          team_size: number | null;
          clan_tag: string;
          opponent_tag: string;
          clan_stars: number | null;
          opponent_stars: number | null;
          clan_destruction: number | null;
          opponent_destruction: number | null;
          clan_attacks: number | null;
          opponent_attacks: number | null;
          start_time: string | null;
          end_time: string | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
          members_captured_at: string | null;
        };
        Insert: {
          id?: string;
          season_id: string;
          war_tag: string;
          day_number?: number | null;
          state?: string | null;
          team_size?: number | null;
          clan_tag: string;
          opponent_tag: string;
          clan_stars?: number | null;
          opponent_stars?: number | null;
          clan_destruction?: number | null;
          opponent_destruction?: number | null;
          clan_attacks?: number | null;
          opponent_attacks?: number | null;
          start_time?: string | null;
          end_time?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          members_captured_at?: string | null;
        };
        Update: {
          id?: string;
          season_id?: string;
          war_tag?: string;
          day_number?: number | null;
          state?: string | null;
          team_size?: number | null;
          clan_tag?: string;
          opponent_tag?: string;
          clan_stars?: number | null;
          opponent_stars?: number | null;
          clan_destruction?: number | null;
          opponent_destruction?: number | null;
          clan_attacks?: number | null;
          opponent_attacks?: number | null;
          start_time?: string | null;
          end_time?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          members_captured_at?: string | null;
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
      cwl_scout_players: {
        Row: {
          id: string;
          season_id: string;
          clan_tag: string;
          tag: string;
          name: string | null;
          th_level: number | null;
          heroes: Json;
          hero_pct: number | null;
          pet_pct: number | null;
          equipment_pct: number | null;
          offence_pct: number | null;
          max_pct: number | null;
          war_stars: number | null;
          captured_at: string;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
          th_weapon_level: number | null;
        };
        Insert: {
          id?: string;
          season_id: string;
          clan_tag: string;
          tag: string;
          name?: string | null;
          th_level?: number | null;
          heroes?: Json;
          hero_pct?: number | null;
          pet_pct?: number | null;
          equipment_pct?: number | null;
          offence_pct?: number | null;
          max_pct?: number | null;
          war_stars?: number | null;
          captured_at?: string;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          th_weapon_level?: number | null;
        };
        Update: {
          id?: string;
          season_id?: string;
          clan_tag?: string;
          tag?: string;
          name?: string | null;
          th_level?: number | null;
          heroes?: Json;
          hero_pct?: number | null;
          pet_pct?: number | null;
          equipment_pct?: number | null;
          offence_pct?: number | null;
          max_pct?: number | null;
          war_stars?: number | null;
          captured_at?: string;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
          th_weapon_level?: number | null;
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
          opponent_badge_url: string | null;
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
          opponent_badge_url?: string | null;
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
          opponent_badge_url?: string | null;
        };
      };
      data_retention: {
        Row: {
          id: boolean;
          thinned_until: string | null;
          keep_months: number | null;
          last_run_at: string | null;
          last_removed: Json | null;
          updated_by: string | null;
        };
        Insert: {
          id?: boolean;
          thinned_until?: string | null;
          keep_months?: number | null;
          last_run_at?: string | null;
          last_removed?: Json | null;
          updated_by?: string | null;
        };
        Update: {
          id?: boolean;
          thinned_until?: string | null;
          keep_months?: number | null;
          last_run_at?: string | null;
          last_removed?: Json | null;
          updated_by?: string | null;
        };
      };
      donation_counters: {
        Row: {
          id: string;
          player_id: string;
          clan_id: string | null;
          captured_at: string;
          troops_donated: number | null;
          spells_donated: number | null;
          sieges_donated: number | null;
          clan_donations: number | null;
          clan_donations_received: number | null;
          created_at: string;
          deleted_at: string | null;
          captured_day: string | null;
        };
        Insert: {
          id?: string;
          player_id: string;
          clan_id?: string | null;
          captured_at?: string;
          troops_donated?: number | null;
          spells_donated?: number | null;
          sieges_donated?: number | null;
          clan_donations?: number | null;
          clan_donations_received?: number | null;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          player_id?: string;
          clan_id?: string | null;
          captured_at?: string;
          troops_donated?: number | null;
          spells_donated?: number | null;
          sieges_donated?: number | null;
          clan_donations?: number | null;
          clan_donations_received?: number | null;
          created_at?: string;
          deleted_at?: string | null;
        };
      };
      feedback: {
        Row: {
          id: string;
          user_id: string;
          rating: number;
          body: string;
          status: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          rating: number;
          body: string;
          status?: string;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          rating?: number;
          body?: string;
          status?: string;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
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
          captured_slot: string | null;
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
          direct_messages: boolean;
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
          direct_messages?: boolean;
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
          direct_messages?: boolean;
        };
      };
      notifications: {
        Row: {
          id: string;
          recipient_id: string;
          sender_id: string | null;
          clan_id: string | null;
          kind: string;
          title: string;
          body: string;
          url: string;
          read_at: string | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          recipient_id: string;
          sender_id?: string | null;
          clan_id?: string | null;
          kind: string;
          title: string;
          body: string;
          url?: string;
          read_at?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          recipient_id?: string;
          sender_id?: string | null;
          clan_id?: string | null;
          kind?: string;
          title?: string;
          body?: string;
          url?: string;
          read_at?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      player_nicknames: {
        Row: {
          id: string;
          player_id: string;
          nickname: string;
          set_by: string;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          player_id: string;
          nickname: string;
          set_by: string;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          player_id?: string;
          nickname?: string;
          set_by?: string;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      player_profiles: {
        Row: {
          id: string;
          player_id: string;
          clan_id: string | null;
          war_preference: string | null;
          exp_level: number | null;
          best_trophies: number | null;
          attack_wins: number | null;
          defense_wins: number | null;
          war_stars: number | null;
          capital_contributions: number | null;
          builder_base_trophies: number | null;
          best_builder_base_trophies: number | null;
          achievements: Json;
          captured_at: string;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          player_id: string;
          clan_id?: string | null;
          war_preference?: string | null;
          exp_level?: number | null;
          best_trophies?: number | null;
          attack_wins?: number | null;
          defense_wins?: number | null;
          war_stars?: number | null;
          capital_contributions?: number | null;
          builder_base_trophies?: number | null;
          best_builder_base_trophies?: number | null;
          achievements?: Json;
          captured_at?: string;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          player_id?: string;
          clan_id?: string | null;
          war_preference?: string | null;
          exp_level?: number | null;
          best_trophies?: number | null;
          attack_wins?: number | null;
          defense_wins?: number | null;
          war_stars?: number | null;
          capital_contributions?: number | null;
          builder_base_trophies?: number | null;
          best_builder_base_trophies?: number | null;
          achievements?: Json;
          captured_at?: string;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
      };
      player_progress: {
        Row: {
          id: string;
          player_id: string;
          clan_id: string | null;
          captured_at: string;
          th_level: number | null;
          th_weapon_level: number | null;
          bh_level: number | null;
          units: Json;
          created_at: string;
          deleted_at: string | null;
          captured_day: string | null;
        };
        Insert: {
          id?: string;
          player_id: string;
          clan_id?: string | null;
          captured_at?: string;
          th_level?: number | null;
          th_weapon_level?: number | null;
          bh_level?: number | null;
          units?: Json;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          player_id?: string;
          clan_id?: string | null;
          captured_at?: string;
          th_level?: number | null;
          th_weapon_level?: number | null;
          bh_level?: number | null;
          units?: Json;
          created_at?: string;
          deleted_at?: string | null;
        };
      };
      player_ratings: {
        Row: {
          id: string;
          month: string;
          player_id: string;
          clan_id: string;
          donation_marks: number;
          war_marks: number;
          cwl_marks: number;
          games_marks: number;
          raid_marks: number;
          donation_share: number;
          war_share: number;
          cwl_share: number;
          games_share: number;
          raid_share: number;
          rating: number;
          computed_at: string;
        };
        Insert: {
          id?: string;
          month: string;
          player_id: string;
          clan_id: string;
          donation_marks: number;
          war_marks: number;
          cwl_marks: number;
          games_marks: number;
          raid_marks: number;
          donation_share: number;
          war_share: number;
          cwl_share: number;
          games_share: number;
          raid_share: number;
          rating: number;
          computed_at: string;
        };
        Update: {
          id?: string;
          month?: string;
          player_id?: string;
          clan_id?: string;
          donation_marks?: number;
          war_marks?: number;
          cwl_marks?: number;
          games_marks?: number;
          raid_marks?: number;
          donation_share?: number;
          war_share?: number;
          cwl_share?: number;
          games_share?: number;
          raid_share?: number;
          rating?: number;
          computed_at?: string;
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
          league_tier: string | null;
          league_tier_id: number | null;
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
          league_tier?: string | null;
          league_tier_id?: number | null;
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
          league_tier?: string | null;
          league_tier_id?: number | null;
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
      raid_attacks: {
        Row: {
          id: string;
          raid_season_id: string;
          raid_number: number;
          district_id: number;
          district_name: string | null;
          district_hall_level: number | null;
          attack_number: number;
          player_id: string;
          destruction: number;
          stars: number;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          raid_season_id: string;
          raid_number: number;
          district_id: number;
          district_name?: string | null;
          district_hall_level?: number | null;
          attack_number: number;
          player_id: string;
          destruction: number;
          stars: number;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          raid_season_id?: string;
          raid_number?: number;
          district_id?: number;
          district_name?: string | null;
          district_hall_level?: number | null;
          attack_number?: number;
          player_id?: string;
          destruction?: number;
          stars?: number;
          created_at?: string;
          deleted_at?: string | null;
        };
      };
      raid_defenses: {
        Row: {
          id: string;
          raid_season_id: string;
          raid_number: number;
          attacker_tag: string;
          attacker_name: string | null;
          attacker_level: number | null;
          district_id: number;
          district_name: string | null;
          district_hall_level: number | null;
          attack_count: number;
          destruction: number;
          stars: number;
          total_looted: number | null;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          raid_season_id: string;
          raid_number: number;
          attacker_tag: string;
          attacker_name?: string | null;
          attacker_level?: number | null;
          district_id: number;
          district_name?: string | null;
          district_hall_level?: number | null;
          attack_count: number;
          destruction: number;
          stars: number;
          total_looted?: number | null;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          raid_season_id?: string;
          raid_number?: number;
          attacker_tag?: string;
          attacker_name?: string | null;
          attacker_level?: number | null;
          district_id?: number;
          district_name?: string | null;
          district_hall_level?: number | null;
          attack_count?: number;
          destruction?: number;
          stars?: number;
          total_looted?: number | null;
          created_at?: string;
          deleted_at?: string | null;
        };
      };
      raid_opponents: {
        Row: {
          id: string;
          raid_season_id: string;
          raid_number: number;
          defender_tag: string;
          defender_name: string | null;
          capital_league_id: number | null;
          capital_league: string | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          raid_season_id: string;
          raid_number: number;
          defender_tag: string;
          defender_name?: string | null;
          capital_league_id?: number | null;
          capital_league?: string | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          raid_season_id?: string;
          raid_number?: number;
          defender_tag?: string;
          defender_name?: string | null;
          capital_league_id?: number | null;
          capital_league?: string | null;
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
          attacks_captured_at: string | null;
          defenses_captured_at: string | null;
          reminded_at: string | null;
          enemy_districts_destroyed: number | null;
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
          attacks_captured_at?: string | null;
          defenses_captured_at?: string | null;
          reminded_at?: string | null;
          enemy_districts_destroyed?: number | null;
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
          attacks_captured_at?: string | null;
          defenses_captured_at?: string | null;
          reminded_at?: string | null;
          enemy_districts_destroyed?: number | null;
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
          username: string | null;
          password_set_at: string | null;
          avatar_path: string | null;
          last_seen_at: string | null;
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
          username?: string | null;
          password_set_at?: string | null;
          avatar_path?: string | null;
          last_seen_at?: string | null;
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
          username?: string | null;
          password_set_at?: string | null;
          avatar_path?: string | null;
          last_seen_at?: string | null;
        };
      };
      village_exports: {
        Row: {
          id: string;
          player_id: string;
          uploaded_by: string;
          exported_at: string;
          th_level: number | null;
          bh_level: number | null;
          village: Json;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          player_id: string;
          uploaded_by: string;
          exported_at: string;
          th_level?: number | null;
          bh_level?: number | null;
          village: Json;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          player_id?: string;
          uploaded_by?: string;
          exported_at?: string;
          th_level?: number | null;
          bh_level?: number | null;
          village?: Json;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
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
          war_order: number | null;
          duration_seconds: number | null;
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
          war_order?: number | null;
          duration_seconds?: number | null;
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
          war_order?: number | null;
          duration_seconds?: number | null;
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
      war_opponent_attacks: {
        Row: {
          id: string;
          war_id: string;
          attacker_tag: string;
          attack_order: number;
          defender_tag: string | null;
          stars: number;
          destruction: number;
          war_order: number | null;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          war_id: string;
          attacker_tag: string;
          attack_order: number;
          defender_tag?: string | null;
          stars: number;
          destruction: number;
          war_order?: number | null;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          war_id?: string;
          attacker_tag?: string;
          attack_order?: number;
          defender_tag?: string | null;
          stars?: number;
          destruction?: number;
          war_order?: number | null;
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
          opponent_badge_url: string | null;
          opponent_attacks_captured_at: string | null;
          reminded_at: string | null;
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
          opponent_badge_url?: string | null;
          opponent_attacks_captured_at?: string | null;
          reminded_at?: string | null;
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
          opponent_badge_url?: string | null;
          opponent_attacks_captured_at?: string | null;
          reminded_at?: string | null;
        };
      };
    };
  };
}

// Row aliases.
export type AccountMessagesRow = Database["public"]["Tables"]["account_messages"]["Row"];
export type AnnouncementsRow = Database["public"]["Tables"]["announcements"]["Row"];
export type AuditLogRow = Database["public"]["Tables"]["audit_log"]["Row"];
export type BaseLayoutVotesRow = Database["public"]["Tables"]["base_layout_votes"]["Row"];
export type BaseLayoutsRow = Database["public"]["Tables"]["base_layouts"]["Row"];
export type ClanGamesRow = Database["public"]["Tables"]["clan_games"]["Row"];
export type ClanGamesScoresRow = Database["public"]["Tables"]["clan_games_scores"]["Row"];
export type ClanProfilesRow = Database["public"]["Tables"]["clan_profiles"]["Row"];
export type ClanRolesRow = Database["public"]["Tables"]["clan_roles"]["Row"];
export type ClansRow = Database["public"]["Tables"]["clans"]["Row"];
export type CwlAttacksRow = Database["public"]["Tables"]["cwl_attacks"]["Row"];
export type CwlBonusesRow = Database["public"]["Tables"]["cwl_bonuses"]["Row"];
export type CwlGroupClansRow = Database["public"]["Tables"]["cwl_group_clans"]["Row"];
export type CwlGroupMembersRow = Database["public"]["Tables"]["cwl_group_members"]["Row"];
export type CwlGroupWarMembersRow = Database["public"]["Tables"]["cwl_group_war_members"]["Row"];
export type CwlGroupWarsRow = Database["public"]["Tables"]["cwl_group_wars"]["Row"];
export type CwlRosterMembersRow = Database["public"]["Tables"]["cwl_roster_members"]["Row"];
export type CwlRostersRow = Database["public"]["Tables"]["cwl_rosters"]["Row"];
export type CwlScoutPlayersRow = Database["public"]["Tables"]["cwl_scout_players"]["Row"];
export type CwlSeasonsRow = Database["public"]["Tables"]["cwl_seasons"]["Row"];
export type CwlWarMembersRow = Database["public"]["Tables"]["cwl_war_members"]["Row"];
export type CwlWarsRow = Database["public"]["Tables"]["cwl_wars"]["Row"];
export type DataRetentionRow = Database["public"]["Tables"]["data_retention"]["Row"];
export type DonationCountersRow = Database["public"]["Tables"]["donation_counters"]["Row"];
export type FeedbackRow = Database["public"]["Tables"]["feedback"]["Row"];
export type MemberSnapshotsRow = Database["public"]["Tables"]["member_snapshots"]["Row"];
export type NotificationPreferencesRow = Database["public"]["Tables"]["notification_preferences"]["Row"];
export type NotificationsRow = Database["public"]["Tables"]["notifications"]["Row"];
export type PlayerNicknamesRow = Database["public"]["Tables"]["player_nicknames"]["Row"];
export type PlayerProfilesRow = Database["public"]["Tables"]["player_profiles"]["Row"];
export type PlayerProgressRow = Database["public"]["Tables"]["player_progress"]["Row"];
export type PlayerRatingsRow = Database["public"]["Tables"]["player_ratings"]["Row"];
export type PlayersRow = Database["public"]["Tables"]["players"]["Row"];
export type PollOptionsRow = Database["public"]["Tables"]["poll_options"]["Row"];
export type PollResponsesRow = Database["public"]["Tables"]["poll_responses"]["Row"];
export type PollsRow = Database["public"]["Tables"]["polls"]["Row"];
export type PushSubscriptionsRow = Database["public"]["Tables"]["push_subscriptions"]["Row"];
export type RaidAttacksRow = Database["public"]["Tables"]["raid_attacks"]["Row"];
export type RaidDefensesRow = Database["public"]["Tables"]["raid_defenses"]["Row"];
export type RaidOpponentsRow = Database["public"]["Tables"]["raid_opponents"]["Row"];
export type RaidParticipantsRow = Database["public"]["Tables"]["raid_participants"]["Row"];
export type RaidSeasonsRow = Database["public"]["Tables"]["raid_seasons"]["Row"];
export type SyncLogRow = Database["public"]["Tables"]["sync_log"]["Row"];
export type UsersRow = Database["public"]["Tables"]["users"]["Row"];
export type WarAttacksRow = Database["public"]["Tables"]["war_attacks"]["Row"];
export type WarLineupMembersRow = Database["public"]["Tables"]["war_lineup_members"]["Row"];
export type WarLineupsRow = Database["public"]["Tables"]["war_lineups"]["Row"];
export type WarMembersRow = Database["public"]["Tables"]["war_members"]["Row"];
export type WarOpponentAttacksRow = Database["public"]["Tables"]["war_opponent_attacks"]["Row"];
export type WarOpponentMembersRow = Database["public"]["Tables"]["war_opponent_members"]["Row"];
export type WarTargetsRow = Database["public"]["Tables"]["war_targets"]["Row"];
export type WarsRow = Database["public"]["Tables"]["wars"]["Row"];
