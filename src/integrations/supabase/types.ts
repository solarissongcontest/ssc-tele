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
            foreignKeyName: "round_results_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
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
          public_advanced_transparency: boolean
          rank_exponent: number
          results_outdated: boolean
          results_status: string
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
          public_advanced_transparency?: boolean
          rank_exponent?: number
          results_outdated?: boolean
          results_status?: string
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
          public_advanced_transparency?: boolean
          rank_exponent?: number
          results_outdated?: boolean
          results_status?: string
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
      vote_submissions: {
        Row: {
          country_code: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
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
