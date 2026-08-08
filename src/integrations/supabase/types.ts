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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      area_owners: {
        Row: {
          code: string | null
          created_at: string
          department: string | null
          department_id: string | null
          employee_id: string | null
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          department?: string | null
          department_id?: string | null
          employee_id?: string | null
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          code?: string | null
          created_at?: string
          department?: string | null
          department_id?: string | null
          employee_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "area_owners_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          role: string | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          role?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          role?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      daily_entries: {
        Row: {
          available_min: number
          comments: string | null
          created_at: string
          custom_fields: Json
          downtime_min: number
          entry_date: string
          id: string
          line_id: string
          making_actual: number
          making_plan: number
          operator: string | null
          packing_actual: number
          packing_plan: number
          rework_cooking: number
          rework_making: number
          rework_packing: number
          shift: string
          supervisor: string | null
          updated_at: string
        }
        Insert: {
          available_min?: number
          comments?: string | null
          created_at?: string
          custom_fields?: Json
          downtime_min?: number
          entry_date: string
          id?: string
          line_id: string
          making_actual?: number
          making_plan?: number
          operator?: string | null
          packing_actual?: number
          packing_plan?: number
          rework_cooking?: number
          rework_making?: number
          rework_packing?: number
          shift?: string
          supervisor?: string | null
          updated_at?: string
        }
        Update: {
          available_min?: number
          comments?: string | null
          created_at?: string
          custom_fields?: Json
          downtime_min?: number
          entry_date?: string
          id?: string
          line_id?: string
          making_actual?: number
          making_plan?: number
          operator?: string | null
          packing_actual?: number
          packing_plan?: number
          rework_cooking?: number
          rework_making?: number
          rework_packing?: number
          shift?: string
          supervisor?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_entries_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "production_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      department_categories: {
        Row: {
          code: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      departments: {
        Row: {
          code: string
          created_at: string
          department_category_id: string | null
          display_order: number
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          department_category_id?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          department_category_id?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_department_category_id_fkey"
            columns: ["department_category_id"]
            isOneToOne: false
            referencedRelation: "department_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      downtime_reasons: {
        Row: {
          area: string
          code: string | null
          created_at: string
          department_id: string | null
          downtime_type_id: string | null
          id: string
          is_active: boolean
          line_id: string | null
          name: string
          production_area_id: string | null
          severity_id: string | null
        }
        Insert: {
          area?: string
          code?: string | null
          created_at?: string
          department_id?: string | null
          downtime_type_id?: string | null
          id?: string
          is_active?: boolean
          line_id?: string | null
          name: string
          production_area_id?: string | null
          severity_id?: string | null
        }
        Update: {
          area?: string
          code?: string | null
          created_at?: string
          department_id?: string | null
          downtime_type_id?: string | null
          id?: string
          is_active?: boolean
          line_id?: string | null
          name?: string
          production_area_id?: string | null
          severity_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "downtime_reasons_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downtime_reasons_downtime_type_id_fkey"
            columns: ["downtime_type_id"]
            isOneToOne: false
            referencedRelation: "downtime_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downtime_reasons_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "production_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downtime_reasons_production_area_id_fkey"
            columns: ["production_area_id"]
            isOneToOne: false
            referencedRelation: "production_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downtime_reasons_severity_id_fkey"
            columns: ["severity_id"]
            isOneToOne: false
            referencedRelation: "severity_levels"
            referencedColumns: ["id"]
          },
        ]
      }
      downtime_types: {
        Row: {
          code: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      entry_area_owners: {
        Row: {
          created_at: string
          entry_id: string
          id: string
          owner_id: string | null
          performance_score: number | null
          production_area_id: string
        }
        Insert: {
          created_at?: string
          entry_id: string
          id?: string
          owner_id?: string | null
          performance_score?: number | null
          production_area_id: string
        }
        Update: {
          created_at?: string
          entry_id?: string
          id?: string
          owner_id?: string | null
          performance_score?: number | null
          production_area_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entry_area_owners_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "daily_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_area_owners_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "area_owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_area_owners_production_area_id_fkey"
            columns: ["production_area_id"]
            isOneToOne: false
            referencedRelation: "production_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      entry_downtimes: {
        Row: {
          area: string
          created_at: string
          entry_id: string
          id: string
          minutes: number
          reason_id: string | null
          reason_name: string
        }
        Insert: {
          area?: string
          created_at?: string
          entry_id: string
          id?: string
          minutes?: number
          reason_id?: string | null
          reason_name: string
        }
        Update: {
          area?: string
          created_at?: string
          entry_id?: string
          id?: string
          minutes?: number
          reason_id?: string | null
          reason_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "entry_downtimes_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "daily_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_downtimes_reason_id_fkey"
            columns: ["reason_id"]
            isOneToOne: false
            referencedRelation: "downtime_reasons"
            referencedColumns: ["id"]
          },
        ]
      }
      line_field_definitions: {
        Row: {
          created_at: string
          default_value: number | null
          field_key: string
          id: string
          label: string
          line_id: string
          section: string
          sort_order: number
          unit: string
        }
        Insert: {
          created_at?: string
          default_value?: number | null
          field_key: string
          id?: string
          label: string
          line_id: string
          section?: string
          sort_order?: number
          unit?: string
        }
        Update: {
          created_at?: string
          default_value?: number | null
          field_key?: string
          id?: string
          label?: string
          line_id?: string
          section?: string
          sort_order?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_field_definitions_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "production_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_events: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          line_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity_label: string | null
          started_at: string
          status: string
          technician: string | null
          technician_ids: string[]
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          line_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity_label?: string | null
          started_at?: string
          status?: string
          technician?: string | null
          technician_ids?: string[]
          title: string
          type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          line_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity_label?: string | null
          started_at?: string
          status?: string
          technician?: string | null
          technician_ids?: string[]
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_events_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "production_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_events_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_notes: {
        Row: {
          created_at: string
          created_by: string | null
          event_id: string
          id: string
          note: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_id: string
          id?: string
          note: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_id?: string
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_notes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "maintenance_events"
            referencedColumns: ["id"]
          },
        ]
      }
      production_areas: {
        Row: {
          code: string | null
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          code?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      production_lines: {
        Row: {
          code: string | null
          color: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          code?: string | null
          color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          code?: string | null
          color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_color: string
          created_at: string
          department_id: string | null
          display_name: string | null
          email: string
          first_name: string | null
          id: string
          last_login: string | null
          last_name: string | null
          must_change_password: boolean
          phone: string | null
          role: string
          status: string
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_color?: string
          created_at?: string
          department_id?: string | null
          display_name?: string | null
          email: string
          first_name?: string | null
          id: string
          last_login?: string | null
          last_name?: string | null
          must_change_password?: boolean
          phone?: string | null
          role?: string
          status?: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_color?: string
          created_at?: string
          department_id?: string | null
          display_name?: string | null
          email?: string
          first_name?: string | null
          id?: string
          last_login?: string | null
          last_name?: string | null
          must_change_password?: boolean
          phone?: string | null
          role?: string
          status?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          created_at: string
          id: string
          subscription: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          subscription: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          subscription?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      severity_levels: {
        Row: {
          code: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      technicians: {
        Row: {
          created_at: string | null
          department: string | null
          id: string
          is_active: boolean | null
          name: string
          role: string | null
        }
        Insert: {
          created_at?: string | null
          department?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          role?: string | null
        }
        Update: {
          created_at?: string | null
          department?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          role?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: { check_user_id: string }; Returns: boolean }
      touch_last_login: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
