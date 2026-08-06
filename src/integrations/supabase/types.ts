export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_accounts: {
        Row: {
          created_at: string
          created_by: string | null
          disabled: boolean
          id: string
          is_super_admin: boolean
          last_login_at: string | null
          password_hash: string
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          disabled?: boolean
          id?: string
          is_super_admin?: boolean
          last_login_at?: string | null
          password_hash: string
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          disabled?: boolean
          id?: string
          is_super_admin?: boolean
          last_login_at?: string | null
          password_hash?: string
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_log: {
        Row: {
          action: string
          actor_admin_id: string | null
          actor_username: string | null
          created_at: string
          id: string
          new_values: Json | null
          old_values: Json | null
          reason: string | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_admin_id?: string | null
          actor_username?: string | null
          created_at?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          reason?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_admin_id?: string | null
          actor_username?: string | null
          created_at?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          reason?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_actor_admin_id_fkey"
            columns: ["actor_admin_id"]
            isOneToOne: false
            referencedRelation: "admin_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_sessions: {
        Row: {
          admin_id: string
          created_at: string
          expires_at: string
          id: string
          ip_hash: string | null
          token_hash: string
          user_agent: string | null
        }
        Insert: {
          admin_id: string
          created_at?: string
          expires_at: string
          id?: string
          ip_hash?: string | null
          token_hash: string
          user_agent?: string | null
        }
        Update: {
          admin_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          ip_hash?: string | null
          token_hash?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_sessions_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      anti_abuse_events: {
        Row: {
          country_code: string | null
          created_at: string
          device_token_hash: string | null
          fingerprint_hash: string | null
          id: string
          ip_hash: string | null
          metadata: Json
          reason: string
          risk_score: number
          round_id: string | null
          status: string
          username: string | null
          username_normalized: string | null
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          device_token_hash?: string | null
          fingerprint_hash?: string | null
          id?: string
          ip_hash?: string | null
          metadata?: Json
          reason: string
          risk_score?: number
          round_id?: string | null
          status?: string
          username?: string | null
          username_normalized?: string | null
        }
        Update: {
          country_code?: string | null
          created_at?: string
          device_token_hash?: string | null
          fingerprint_hash?: string | null
          id?: string
          ip_hash?: string | null
          metadata?: Json
          reason?: string
          risk_score?: number
          round_id?: string | null
          status?: string
          username?: string | null
          username_normalized?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "anti_abuse_events_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      combined_televote_component_results: {
        Row: {
          aggregation_id: string
          calculated_at: string
          calculation_version: number
          component_id: string
          component_name: string
          component_pool: number
          component_type: string
          country_code: string
          created_at: string
          decimal_remainder: number
          exact_allocation: number
          final_allocated_points: number
          floored_allocation: number
          id: string
          method: string
          participant_count: number
          percentage_weight: number
          rank_base: number | null
          rank_exponent: number | null
          rank_factor: number | null
          raw_rank: number | null
          raw_score: number
          remainder_bonus: number
          source_weighted_total: number | null
          tie_break_data: Json
          weighted_score: number | null
        }
        Insert: {
          aggregation_id: string
          calculated_at?: string
          calculation_version?: number
          component_id: string
          component_name?: string
          component_pool?: number
          component_type?: string
          country_code: string
          created_at?: string
          decimal_remainder?: number
          exact_allocation?: number
          final_allocated_points?: number
          floored_allocation?: number
          id?: string
          method?: string
          participant_count?: number
          percentage_weight?: number
          rank_base?: number | null
          rank_exponent?: number | null
          rank_factor?: number | null
          raw_rank?: number | null
          raw_score?: number
          remainder_bonus?: number
          source_weighted_total?: number | null
          tie_break_data?: Json
          weighted_score?: number | null
        }
        Update: {
          aggregation_id?: string
          calculated_at?: string
          calculation_version?: number
          component_id?: string
          component_name?: string
          component_pool?: number
          component_type?: string
          country_code?: string
          created_at?: string
          decimal_remainder?: number
          exact_allocation?: number
          final_allocated_points?: number
          floored_allocation?: number
          id?: string
          method?: string
          participant_count?: number
          percentage_weight?: number
          rank_base?: number | null
          rank_exponent?: number | null
          rank_factor?: number | null
          raw_rank?: number | null
          raw_score?: number
          remainder_bonus?: number
          source_weighted_total?: number | null
          tie_break_data?: Json
          weighted_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "combined_televote_component_results_aggregation_id_fkey"
            columns: ["aggregation_id"]
            isOneToOne: false
            referencedRelation: "televote_aggregations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combined_televote_component_results_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "televote_aggregation_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      combined_televote_results: {
        Row: {
          aggregation_id: string
          calculated_at: string
          calculation_version: number
          combined_original_rank: number
          combined_original_score: number
          component_breakdown: Json
          converted_points: number
          country_code: string
          created_at: string
          decimal_remainder: number
          exact_converted_points: number
          final_combined_points: number
          final_correction: number
          final_rank: number
          final_televote_score: number
          final_tie_break_data: Json
          floored_points: number
          id: string
          manual_pre_conversion_adjustment: number
          participant_count: number
          post_conversion_adjustment: number
          post_conversion_bonus: number
          pre_conversion_total: number
          rank_base: number
          rank_exponent: number
          rank_factor: number
          remainder_bonus: number
          source_contributions: Json
          total_activity_points: number
          total_voting_points: number
          updated_at: string
          weighted_score: number
        }
        Insert: {
          aggregation_id: string
          calculated_at?: string
          calculation_version?: number
          combined_original_rank?: number
          combined_original_score?: number
          component_breakdown?: Json
          converted_points?: number
          country_code: string
          created_at?: string
          decimal_remainder?: number
          exact_converted_points?: number
          final_combined_points?: number
          final_correction?: number
          final_rank?: number
          final_televote_score?: number
          final_tie_break_data?: Json
          floored_points?: number
          id?: string
          manual_pre_conversion_adjustment?: number
          participant_count?: number
          post_conversion_adjustment?: number
          post_conversion_bonus?: number
          pre_conversion_total?: number
          rank_base?: number
          rank_exponent?: number
          rank_factor?: number
          remainder_bonus?: number
          source_contributions?: Json
          total_activity_points?: number
          total_voting_points?: number
          updated_at?: string
          weighted_score?: number
        }
        Update: {
          aggregation_id?: string
          calculated_at?: string
          calculation_version?: number
          combined_original_rank?: number
          combined_original_score?: number
          component_breakdown?: Json
          converted_points?: number
          country_code?: string
          created_at?: string
          decimal_remainder?: number
          exact_converted_points?: number
          final_combined_points?: number
          final_correction?: number
          final_rank?: number
          final_televote_score?: number
          final_tie_break_data?: Json
          floored_points?: number
          id?: string
          manual_pre_conversion_adjustment?: number
          participant_count?: number
          post_conversion_adjustment?: number
          post_conversion_bonus?: number
          pre_conversion_total?: number
          rank_base?: number
          rank_exponent?: number
          rank_factor?: number
          remainder_bonus?: number
          source_contributions?: Json
          total_activity_points?: number
          total_voting_points?: number
          updated_at?: string
          weighted_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "combined_televote_results_aggregation_id_fkey"
            columns: ["aggregation_id"]
            isOneToOne: false
            referencedRelation: "televote_aggregations"
            referencedColumns: ["id"]
          },
        ]
      }
      countries: {
        Row: {
          code: string
          flag: string
          flag_url: string | null
          name: string
        }
        Insert: {
          code: string
          flag: string
          flag_url?: string | null
          name: string
        }
        Update: {
          code?: string
          flag?: string
          flag_url?: string | null
          name?: string
        }
        Relationships: []
      }
      editions: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_archived: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_archived?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_archived?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      external_score_entries: {
        Row: {
          country_code: string
          created_at: string
          entered_by: string | null
          entry_type: string
          id: string
          reason: string | null
          source_id: string
          updated_at: string
          value: number
        }
        Insert: {
          country_code: string
          created_at?: string
          entered_by?: string | null
          entry_type?: string
          id?: string
          reason?: string | null
          source_id: string
          updated_at?: string
          value?: number
        }
        Update: {
          country_code?: string
          created_at?: string
          entered_by?: string | null
          entry_type?: string
          id?: string
          reason?: string | null
          source_id?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "external_score_entries_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "televote_aggregation_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      external_score_entry_log: {
        Row: {
          actor_username: string | null
          aggregation_id: string | null
          country_code: string | null
          created_at: string
          delta: number | null
          entry_type: string | null
          id: string
          new_value: number | null
          previous_value: number | null
          reason: string | null
          source_id: string | null
        }
        Insert: {
          actor_username?: string | null
          aggregation_id?: string | null
          country_code?: string | null
          created_at?: string
          delta?: number | null
          entry_type?: string | null
          id?: string
          new_value?: number | null
          previous_value?: number | null
          reason?: string | null
          source_id?: string | null
        }
        Update: {
          actor_username?: string | null
          aggregation_id?: string | null
          country_code?: string | null
          created_at?: string
          delta?: number | null
          entry_type?: string | null
          id?: string
          new_value?: number | null
          previous_value?: number | null
          reason?: string | null
          source_id?: string | null
        }
        Relationships: []
      }
      friend_voting_groups: {
        Row: {
          analysis_version: number
          average_external_support: number
          average_internal_support: number
          calculated_at: string
          created_at: string
          deleted_internal_ballots: number
          edges: Json
          editions_observed: number
          group_reciprocity: number
          id: string
          internal_maximum_share: number
          internal_point_share: number
          internal_top_three_share: number
          label: string
          members: string[]
          moderator_note: string | null
          reasons: Json
          repeated_after_moderation: number
          review_status: string
          risk_label: string
          risk_score: number
          rounds_observed: number
          strong_internal_edges: number
          updated_at: string
        }
        Insert: {
          analysis_version?: number
          average_external_support?: number
          average_internal_support?: number
          calculated_at?: string
          created_at?: string
          deleted_internal_ballots?: number
          edges?: Json
          editions_observed?: number
          group_reciprocity?: number
          id?: string
          internal_maximum_share?: number
          internal_point_share?: number
          internal_top_three_share?: number
          label: string
          members?: string[]
          moderator_note?: string | null
          reasons?: Json
          repeated_after_moderation?: number
          review_status?: string
          risk_label?: string
          risk_score?: number
          rounds_observed?: number
          strong_internal_edges?: number
          updated_at?: string
        }
        Update: {
          analysis_version?: number
          average_external_support?: number
          average_internal_support?: number
          calculated_at?: string
          created_at?: string
          deleted_internal_ballots?: number
          edges?: Json
          editions_observed?: number
          group_reciprocity?: number
          id?: string
          internal_maximum_share?: number
          internal_point_share?: number
          internal_top_three_share?: number
          label?: string
          members?: string[]
          moderator_note?: string | null
          reasons?: Json
          repeated_after_moderation?: number
          review_status?: string
          risk_label?: string
          risk_score?: number
          rounds_observed?: number
          strong_internal_edges?: number
          updated_at?: string
        }
        Relationships: []
      }
      friend_voting_relationships: {
        Row: {
          active_maximum_score_count: number
          active_opportunities: number
          active_points: number
          analysis_version: number
          audience_uplift: number
          average_ballot_rank: number | null
          average_points: number
          average_points_supported: number
          calculated_at: string
          clique_score: number
          created_at: string
          current_support_streak: number
          deleted_maximum_score_count: number
          deleted_opportunities: number
          deleted_points: number
          editions_count: number
          first_support_at: string | null
          id: string
          last_maximum_at: string | null
          last_support_at: string | null
          longest_support_streak: number
          maximum_score_count: number
          maximum_score_frequency: number
          moderator_note: string | null
          normalized_audience_uplift: number
          preference_lift: number
          previous_coordination_deletions: number
          previous_duplicate_deletions: number
          previous_friend_vote_deletions: number
          reasons: Json
          reciprocity_score: number
          repeated_after_moderation: boolean
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          risk_label: string
          risk_score: number
          rounds_count: number
          second_score_count: number
          shared_opportunities: number
          support_count: number
          support_frequency: number
          target_country_code: string
          timeline: Json
          top_score_concentration: number
          top_three_count: number
          top_three_frequency: number
          total_points: number
          updated_at: string
          voting_country_code: string
        }
        Insert: {
          active_maximum_score_count?: number
          active_opportunities?: number
          active_points?: number
          analysis_version?: number
          audience_uplift?: number
          average_ballot_rank?: number | null
          average_points?: number
          average_points_supported?: number
          calculated_at?: string
          clique_score?: number
          created_at?: string
          current_support_streak?: number
          deleted_maximum_score_count?: number
          deleted_opportunities?: number
          deleted_points?: number
          editions_count?: number
          first_support_at?: string | null
          id?: string
          last_maximum_at?: string | null
          last_support_at?: string | null
          longest_support_streak?: number
          maximum_score_count?: number
          maximum_score_frequency?: number
          moderator_note?: string | null
          normalized_audience_uplift?: number
          preference_lift?: number
          previous_coordination_deletions?: number
          previous_duplicate_deletions?: number
          previous_friend_vote_deletions?: number
          reasons?: Json
          reciprocity_score?: number
          repeated_after_moderation?: boolean
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_label?: string
          risk_score?: number
          rounds_count?: number
          second_score_count?: number
          shared_opportunities?: number
          support_count?: number
          support_frequency?: number
          target_country_code: string
          timeline?: Json
          top_score_concentration?: number
          top_three_count?: number
          top_three_frequency?: number
          total_points?: number
          updated_at?: string
          voting_country_code: string
        }
        Update: {
          active_maximum_score_count?: number
          active_opportunities?: number
          active_points?: number
          analysis_version?: number
          audience_uplift?: number
          average_ballot_rank?: number | null
          average_points?: number
          average_points_supported?: number
          calculated_at?: string
          clique_score?: number
          created_at?: string
          current_support_streak?: number
          deleted_maximum_score_count?: number
          deleted_opportunities?: number
          deleted_points?: number
          editions_count?: number
          first_support_at?: string | null
          id?: string
          last_maximum_at?: string | null
          last_support_at?: string | null
          longest_support_streak?: number
          maximum_score_count?: number
          maximum_score_frequency?: number
          moderator_note?: string | null
          normalized_audience_uplift?: number
          preference_lift?: number
          previous_coordination_deletions?: number
          previous_duplicate_deletions?: number
          previous_friend_vote_deletions?: number
          reasons?: Json
          reciprocity_score?: number
          repeated_after_moderation?: boolean
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_label?: string
          risk_score?: number
          rounds_count?: number
          second_score_count?: number
          shared_opportunities?: number
          support_count?: number
          support_frequency?: number
          target_country_code?: string
          timeline?: Json
          top_score_concentration?: number
          top_three_count?: number
          top_three_frequency?: number
          total_points?: number
          updated_at?: string
          voting_country_code?: string
        }
        Relationships: []
      }
      friend_voting_settings: {
        Row: {
          created_at: string
          id: string
          settings: Json
          singleton: boolean
          updated_at: string
          updated_by_username: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          settings?: Json
          singleton?: boolean
          updated_at?: string
          updated_by_username?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          settings?: Json
          singleton?: boolean
          updated_at?: string
          updated_by_username?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          is_admin: boolean | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id: string
          is_admin?: boolean | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          is_admin?: boolean | null
        }
        Relationships: []
      }
      round_countries: {
        Row: {
          country_code: string
          display_order: number
          id: string
          round_id: string
        }
        Insert: {
          country_code: string
          display_order: number
          id?: string
          round_id: string
        }
        Update: {
          country_code?: string
          display_order?: number
          id?: string
          round_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "round_countries_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "round_countries_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      round_entries: {
        Row: {
          country_code: string | null
          created_at: string
          custom_name: string | null
          description: string | null
          display_order: number
          entry_code: string | null
          entry_key: string
          entry_type: string
          id: string
          image_url: string | null
          round_id: string
          short_name: string | null
          subtitle: string | null
          updated_at: string
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          custom_name?: string | null
          description?: string | null
          display_order?: number
          entry_code?: string | null
          entry_key: string
          entry_type?: string
          id?: string
          image_url?: string | null
          round_id: string
          short_name?: string | null
          subtitle?: string | null
          updated_at?: string
        }
        Update: {
          country_code?: string | null
          created_at?: string
          custom_name?: string | null
          description?: string | null
          display_order?: number
          entry_code?: string | null
          entry_key?: string
          entry_type?: string
          id?: string
          image_url?: string | null
          round_id?: string
          short_name?: string | null
          subtitle?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "round_entries_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      round_results: {
        Row: {
          calculated_at: string
          calculated_by_username: string | null
          calculation_version: number
          country_code: string
          created_at: string
          decimal_remainder: number
          exact_points: number
          final_points: number
          floored_points: number
          id: string
          original_rank: number
          original_voters: number
          original_votes: number
          participant_count: number
          rank_base: number
          rank_exponent: number
          rank_factor: number
          remainder_bonus: number
          round_id: string
          total_points_to_distribute: number
          updated_at: string
          weighted_score: number
        }
        Insert: {
          calculated_at?: string
          calculated_by_username?: string | null
          calculation_version: number
          country_code: string
          created_at?: string
          decimal_remainder: number
          exact_points: number
          final_points: number
          floored_points: number
          id?: string
          original_rank: number
          original_voters?: number
          original_votes?: number
          participant_count: number
          rank_base: number
          rank_exponent: number
          rank_factor: number
          remainder_bonus?: number
          round_id: string
          total_points_to_distribute: number
          updated_at?: string
          weighted_score: number
        }
        Update: {
          calculated_at?: string
          calculated_by_username?: string | null
          calculation_version?: number
          country_code?: string
          created_at?: string
          decimal_remainder?: number
          exact_points?: number
          final_points?: number
          floored_points?: number
          id?: string
          original_rank?: number
          original_voters?: number
          original_votes?: number
          participant_count?: number
          rank_base?: number
          rank_exponent?: number
          rank_factor?: number
          remainder_bonus?: number
          round_id?: string
          total_points_to_distribute?: number
          updated_at?: string
          weighted_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "round_results_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      rounds: {
        Row: {
          broadcast_display_mode: string
          calc_participant_codes: string[] | null
          calculated_at: string | null
          calculated_by: string | null
          calculated_by_username: string | null
          calculation_version: number
          closed_at: string | null
          created_at: string
          edition_id: string
          id: string
          name: string
          opened_at: string | null
          participant_mode: string
          public_advanced_transparency: boolean
          rank_exponent: number
          results_outdated: boolean
          results_status: string
          self_voting_mode: string
          status: Database["public"]["Enums"]["round_status"]
          total_points_to_distribute: number
          updated_at: string
        }
        Insert: {
          broadcast_display_mode?: string
          calc_participant_codes?: string[] | null
          calculated_at?: string | null
          calculated_by?: string | null
          calculated_by_username?: string | null
          calculation_version?: number
          closed_at?: string | null
          created_at?: string
          edition_id: string
          id?: string
          name: string
          opened_at?: string | null
          participant_mode?: string
          public_advanced_transparency?: boolean
          rank_exponent?: number
          results_outdated?: boolean
          results_status?: string
          self_voting_mode?: string
          status?: Database["public"]["Enums"]["round_status"]
          total_points_to_distribute?: number
          updated_at?: string
        }
        Update: {
          broadcast_display_mode?: string
          calc_participant_codes?: string[] | null
          calculated_at?: string | null
          calculated_by?: string | null
          calculated_by_username?: string | null
          calculation_version?: number
          closed_at?: string | null
          created_at?: string
          edition_id?: string
          id?: string
          name?: string
          opened_at?: string | null
          participant_mode?: string
          public_advanced_transparency?: boolean
          rank_exponent?: number
          results_outdated?: boolean
          results_status?: string
          self_voting_mode?: string
          status?: Database["public"]["Enums"]["round_status"]
          total_points_to_distribute?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rounds_edition_id_fkey"
            columns: ["edition_id"]
            isOneToOne: false
            referencedRelation: "editions"
            referencedColumns: ["id"]
          },
        ]
      }
      televote_aggregation_participants: {
        Row: {
          aggregation_id: string
          country_code: string
          created_at: string
          display_order: number
          id: string
        }
        Insert: {
          aggregation_id: string
          country_code: string
          created_at?: string
          display_order?: number
          id?: string
        }
        Update: {
          aggregation_id?: string
          country_code?: string
          created_at?: string
          display_order?: number
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "televote_aggregation_participants_aggregation_id_fkey"
            columns: ["aggregation_id"]
            isOneToOne: false
            referencedRelation: "televote_aggregations"
            referencedColumns: ["id"]
          },
        ]
      }
      televote_aggregation_sources: {
        Row: {
          aggregation_id: string
          calculation_method: string
          calculation_stage: string
          correction_scope: string
          correction_target_source_id: string | null
          created_at: string
          display_order: number
          enabled: boolean
          exact_point_pool: number
          final_point_pool: number
          floored_point_pool: number
          id: string
          input_mode: string
          percentage_weight: number
          pool_remainder: number
          pool_remainder_bonus: number
          source_name: string
          source_round_id: string | null
          source_type: string
          tie_break_data: Json
          updated_at: string
          weight: number
        }
        Insert: {
          aggregation_id: string
          calculation_method?: string
          calculation_stage?: string
          correction_scope?: string
          correction_target_source_id?: string | null
          created_at?: string
          display_order?: number
          enabled?: boolean
          exact_point_pool?: number
          final_point_pool?: number
          floored_point_pool?: number
          id?: string
          input_mode?: string
          percentage_weight?: number
          pool_remainder?: number
          pool_remainder_bonus?: number
          source_name: string
          source_round_id?: string | null
          source_type?: string
          tie_break_data?: Json
          updated_at?: string
          weight?: number
        }
        Update: {
          aggregation_id?: string
          calculation_method?: string
          calculation_stage?: string
          correction_scope?: string
          correction_target_source_id?: string | null
          created_at?: string
          display_order?: number
          enabled?: boolean
          exact_point_pool?: number
          final_point_pool?: number
          floored_point_pool?: number
          id?: string
          input_mode?: string
          percentage_weight?: number
          pool_remainder?: number
          pool_remainder_bonus?: number
          source_name?: string
          source_round_id?: string | null
          source_type?: string
          tie_break_data?: Json
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "televote_aggregation_sources_aggregation_id_fkey"
            columns: ["aggregation_id"]
            isOneToOne: false
            referencedRelation: "televote_aggregations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "televote_aggregation_sources_correction_target_source_id_fkey"
            columns: ["correction_target_source_id"]
            isOneToOne: false
            referencedRelation: "televote_aggregation_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "televote_aggregation_sources_source_round_id_fkey"
            columns: ["source_round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      televote_aggregations: {
        Row: {
          broadcast_display_mode: string
          calculated_at: string | null
          calculated_by: string | null
          calculated_by_username: string | null
          calculation_version: number
          combination_method: string
          created_at: string
          edition_id: string | null
          id: string
          locked_at: string | null
          name: string
          public_columns: Json
          published_at: string | null
          rank_exponent: number
          results_outdated: boolean
          status: string
          total_points_to_distribute: number
          updated_at: string
        }
        Insert: {
          broadcast_display_mode?: string
          calculated_at?: string | null
          calculated_by?: string | null
          calculated_by_username?: string | null
          calculation_version?: number
          combination_method?: string
          created_at?: string
          edition_id?: string | null
          id?: string
          locked_at?: string | null
          name: string
          public_columns?: Json
          published_at?: string | null
          rank_exponent?: number
          results_outdated?: boolean
          status?: string
          total_points_to_distribute?: number
          updated_at?: string
        }
        Update: {
          broadcast_display_mode?: string
          calculated_at?: string | null
          calculated_by?: string | null
          calculated_by_username?: string | null
          calculation_version?: number
          combination_method?: string
          created_at?: string
          edition_id?: string | null
          id?: string
          locked_at?: string | null
          name?: string
          public_columns?: Json
          published_at?: string | null
          rank_exponent?: number
          results_outdated?: boolean
          status?: string
          total_points_to_distribute?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "televote_aggregations_edition_id_fkey"
            columns: ["edition_id"]
            isOneToOne: false
            referencedRelation: "editions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: number
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: never
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: never
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vote_entries: {
        Row: {
          id: string
          points: number
          submission_id: string
          target_country_code: string
        }
        Insert: {
          id?: string
          points: number
          submission_id: string
          target_country_code: string
        }
        Update: {
          id?: string
          points?: number
          submission_id?: string
          target_country_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "vote_entries_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "vote_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      vote_moderation_events: {
        Row: {
          action: string
          id: string
          moderator_note: string | null
          new_status: string | null
          performed_at: string
          performed_by: string | null
          performed_by_username: string | null
          previous_status: string | null
          reason_category: string | null
          target_country_code: string | null
          vote_submission_id: string | null
          voting_country_code: string | null
        }
        Insert: {
          action: string
          id?: string
          moderator_note?: string | null
          new_status?: string | null
          performed_at?: string
          performed_by?: string | null
          performed_by_username?: string | null
          previous_status?: string | null
          reason_category?: string | null
          target_country_code?: string | null
          vote_submission_id?: string | null
          voting_country_code?: string | null
        }
        Update: {
          action?: string
          id?: string
          moderator_note?: string | null
          new_status?: string | null
          performed_at?: string
          performed_by?: string | null
          performed_by_username?: string | null
          previous_status?: string | null
          reason_category?: string | null
          target_country_code?: string | null
          vote_submission_id?: string | null
          voting_country_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vote_moderation_events_vote_submission_id_fkey"
            columns: ["vote_submission_id"]
            isOneToOne: false
            referencedRelation: "vote_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      vote_submissions: {
        Row: {
          country_code: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deletion_category: string | null
          deletion_reason: string | null
          device_token_hash: string | null
          edited_at: string | null
          edited_by: string | null
          fingerprint_hash: string | null
          id: string
          ip_country: string | null
          ip_hash: string | null
          is_vpn: boolean
          moderator_note: string | null
          risk_score: number
          round_id: string
          status: string
          username: string
          username_normalized: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          country_code: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_category?: string | null
          deletion_reason?: string | null
          device_token_hash?: string | null
          edited_at?: string | null
          edited_by?: string | null
          fingerprint_hash?: string | null
          id?: string
          ip_country?: string | null
          ip_hash?: string | null
          is_vpn?: boolean
          moderator_note?: string | null
          risk_score?: number
          round_id: string
          status?: string
          username: string
          username_normalized: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          country_code?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_category?: string | null
          deletion_reason?: string | null
          device_token_hash?: string | null
          edited_at?: string | null
          edited_by?: string | null
          fingerprint_hash?: string | null
          id?: string
          ip_country?: string | null
          ip_hash?: string | null
          is_vpn?: boolean
          moderator_note?: string | null
          risk_score?: number
          round_id?: string
          status?: string
          username?: string
          username_normalized?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vote_submissions_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_hash_password: { Args: { _password: string }; Returns: string }
      admin_verify_credentials: {
        Args: { _password: string; _username: string }
        Returns: {
          id: string
          is_super_admin: boolean
          username: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      submit_vote:
        | {
            Args: {
              p_country_code: string
              p_device_token_hash?: string
              p_entries: Json
              p_fingerprint_hash?: string
              p_ip_hash?: string
              p_round_id: string
              p_username: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_country_code: string
              p_device_token_hash?: string
              p_entries: Json
              p_fingerprint_hash?: string
              p_ip_country?: string
              p_ip_hash?: string
              p_is_vpn?: boolean
              p_round_id: string
              p_username: string
            }
            Returns: Json
          }
    }
    Enums: {
      app_role: "admin" | "user"
      round_status: "draft" | "open" | "closed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      round_status: ["draft", "open", "closed"],
    },
  },
} as const
