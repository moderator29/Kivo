// Generated from the live schema via the Supabase MCP server — do not hand-edit.
// Regenerate after every migration in supabase/migrations/.

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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_conversations: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["ai_message_role"]
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["ai_message_role"]
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["ai_message_role"]
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_profile_id: string | null
          created_at: string
          id: string
          metadata: Json
          reason: string | null
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          reason?: string | null
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          reason?: string | null
          target_id?: string | null
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      badges: {
        Row: {
          code: string
          created_at: string
          description: string | null
          icon_url: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          icon_url?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          icon_url?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      comments: {
        Row: {
          author_profile_id: string
          body: string
          created_at: string
          id: string
          parent_comment_id: string | null
          post_id: string
          updated_at: string
        }
        Insert: {
          author_profile_id: string
          body: string
          created_at?: string
          id?: string
          parent_comment_id?: string | null
          post_id: string
          updated_at?: string
        }
        Update: {
          author_profile_id?: string
          body?: string
          created_at?: string
          id?: string
          parent_comment_id?: string | null
          post_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      competitions: {
        Row: {
          country: string | null
          created_at: string
          id: string
          logo_url: string | null
          name: string
          short_name: string | null
          updated_at: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          short_name?: string | null
          updated_at?: string
        }
        Update: {
          country?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          short_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      fantasy_gameweeks: {
        Row: {
          created_at: string
          deadline_at: string
          id: string
          is_current: boolean
          number: number
          season_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deadline_at: string
          id?: string
          is_current?: boolean
          number: number
          season_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deadline_at?: string
          id?: string
          is_current?: boolean
          number?: number
          season_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fantasy_gameweeks_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      fantasy_leagues: {
        Row: {
          created_at: string
          creator_profile_id: string
          id: string
          invite_code: string | null
          is_private: boolean
          max_teams: number
          name: string
          season_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          creator_profile_id: string
          id?: string
          invite_code?: string | null
          is_private?: boolean
          max_teams?: number
          name: string
          season_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          creator_profile_id?: string
          id?: string
          invite_code?: string | null
          is_private?: boolean
          max_teams?: number
          name?: string
          season_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fantasy_leagues_creator_profile_id_fkey"
            columns: ["creator_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fantasy_leagues_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      fantasy_points: {
        Row: {
          created_at: string
          fantasy_team_id: string
          gameweek_id: string
          id: string
          points: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          fantasy_team_id: string
          gameweek_id: string
          id?: string
          points?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          fantasy_team_id?: string
          gameweek_id?: string
          id?: string
          points?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fantasy_points_fantasy_team_id_fkey"
            columns: ["fantasy_team_id"]
            isOneToOne: false
            referencedRelation: "fantasy_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fantasy_points_gameweek_id_fkey"
            columns: ["gameweek_id"]
            isOneToOne: false
            referencedRelation: "fantasy_gameweeks"
            referencedColumns: ["id"]
          },
        ]
      }
      fantasy_rosters: {
        Row: {
          created_at: string
          fantasy_team_id: string
          gameweek_id: string
          id: string
          is_captain: boolean
          is_starting: boolean
          is_vice_captain: boolean
          player_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          fantasy_team_id: string
          gameweek_id: string
          id?: string
          is_captain?: boolean
          is_starting?: boolean
          is_vice_captain?: boolean
          player_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          fantasy_team_id?: string
          gameweek_id?: string
          id?: string
          is_captain?: boolean
          is_starting?: boolean
          is_vice_captain?: boolean
          player_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fantasy_rosters_fantasy_team_id_fkey"
            columns: ["fantasy_team_id"]
            isOneToOne: false
            referencedRelation: "fantasy_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fantasy_rosters_gameweek_id_fkey"
            columns: ["gameweek_id"]
            isOneToOne: false
            referencedRelation: "fantasy_gameweeks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fantasy_rosters_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      fantasy_teams: {
        Row: {
          created_at: string
          id: string
          league_id: string
          name: string
          owner_profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          name: string
          owner_profile_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          name?: string
          owner_profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fantasy_teams_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "fantasy_leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fantasy_teams_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fixture_events: {
        Row: {
          added_time: number | null
          created_at: string
          detail: string | null
          event_type: Database["public"]["Enums"]["fixture_event_type"]
          fixture_id: string
          id: string
          minute: number
          player_id: string | null
          related_player_id: string | null
          team_id: string
        }
        Insert: {
          added_time?: number | null
          created_at?: string
          detail?: string | null
          event_type: Database["public"]["Enums"]["fixture_event_type"]
          fixture_id: string
          id?: string
          minute: number
          player_id?: string | null
          related_player_id?: string | null
          team_id: string
        }
        Update: {
          added_time?: number | null
          created_at?: string
          detail?: string | null
          event_type?: Database["public"]["Enums"]["fixture_event_type"]
          fixture_id?: string
          id?: string
          minute?: number
          player_id?: string | null
          related_player_id?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixture_events_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_events_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_events_related_player_id_fkey"
            columns: ["related_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      fixtures: {
        Row: {
          away_score: number | null
          away_score_ht: number | null
          away_team_id: string
          competition_id: string
          created_at: string
          home_score: number | null
          home_score_ht: number | null
          home_team_id: string
          id: string
          kickoff_at: string
          matchday: number | null
          season_id: string
          status: Database["public"]["Enums"]["fixture_status"]
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          away_score?: number | null
          away_score_ht?: number | null
          away_team_id: string
          competition_id: string
          created_at?: string
          home_score?: number | null
          home_score_ht?: number | null
          home_team_id: string
          id?: string
          kickoff_at: string
          matchday?: number | null
          season_id: string
          status?: Database["public"]["Enums"]["fixture_status"]
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          away_score?: number | null
          away_score_ht?: number | null
          away_team_id?: string
          competition_id?: string
          created_at?: string
          home_score?: number | null
          home_score_ht?: number | null
          home_team_id?: string
          id?: string
          kickoff_at?: string
          matchday?: number | null
          season_id?: string
          status?: Database["public"]["Enums"]["fixture_status"]
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fixtures_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          created_at: string
          followed_id: string
          followed_type: Database["public"]["Enums"]["follow_target_type"]
          follower_profile_id: string
          id: string
        }
        Insert: {
          created_at?: string
          followed_id: string
          followed_type: Database["public"]["Enums"]["follow_target_type"]
          follower_profile_id: string
          id?: string
        }
        Update: {
          created_at?: string
          followed_id?: string
          followed_type?: Database["public"]["Enums"]["follow_target_type"]
          follower_profile_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_follower_profile_id_fkey"
            columns: ["follower_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lineups: {
        Row: {
          created_at: string
          fixture_id: string
          id: string
          is_starting: boolean
          player_id: string
          position: string | null
          shirt_number: number | null
          team_id: string
        }
        Insert: {
          created_at?: string
          fixture_id: string
          id?: string
          is_starting?: boolean
          player_id: string
          position?: string | null
          shirt_number?: number | null
          team_id: string
        }
        Update: {
          created_at?: string
          fixture_id?: string
          id?: string
          is_starting?: boolean
          player_id?: string
          position?: string | null
          shirt_number?: number | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lineups_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineups_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      managers: {
        Row: {
          created_at: string
          current_team_id: string | null
          date_of_birth: string | null
          full_name: string
          id: string
          nationality: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_team_id?: string | null
          date_of_birth?: string | null
          full_name: string
          id?: string
          nationality?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_team_id?: string | null
          date_of_birth?: string | null
          full_name?: string
          id?: string
          nationality?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "managers_current_team_id_fkey"
            columns: ["current_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_actions: {
        Row: {
          action: string
          admin_profile_id: string | null
          created_at: string
          id: string
          reason: string | null
          report_id: string | null
          target_id: string
          target_type: Database["public"]["Enums"]["moderation_target_type"]
        }
        Insert: {
          action: string
          admin_profile_id?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          report_id?: string | null
          target_id: string
          target_type: Database["public"]["Enums"]["moderation_target_type"]
        }
        Update: {
          action?: string
          admin_profile_id?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          report_id?: string | null
          target_id?: string
          target_type?: Database["public"]["Enums"]["moderation_target_type"]
        }
        Relationships: [
          {
            foreignKeyName: "moderation_actions_admin_profile_id_fkey"
            columns: ["admin_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_actions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          channel: Database["public"]["Enums"]["delivery_channel"]
          created_at: string
          failed_reason: string | null
          id: string
          notification_id: string
          provider: string | null
          provider_message_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["delivery_status"]
        }
        Insert: {
          channel: Database["public"]["Enums"]["delivery_channel"]
          created_at?: string
          failed_reason?: string | null
          id?: string
          notification_id: string
          provider?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
        }
        Update: {
          channel?: Database["public"]["Enums"]["delivery_channel"]
          created_at?: string
          failed_reason?: string | null
          id?: string
          notification_id?: string
          provider?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string
          email_enabled: boolean
          fantasy_alerts_enabled: boolean
          in_app_enabled: boolean
          marketing_emails_enabled: boolean
          match_alerts_enabled: boolean
          prediction_alerts_enabled: boolean
          profile_id: string
          push_enabled: boolean
          social_alerts_enabled: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          email_enabled?: boolean
          fantasy_alerts_enabled?: boolean
          in_app_enabled?: boolean
          marketing_emails_enabled?: boolean
          match_alerts_enabled?: boolean
          prediction_alerts_enabled?: boolean
          profile_id: string
          push_enabled?: boolean
          social_alerts_enabled?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          email_enabled?: boolean
          fantasy_alerts_enabled?: boolean
          in_app_enabled?: boolean
          marketing_emails_enabled?: boolean
          match_alerts_enabled?: boolean
          prediction_alerts_enabled?: boolean
          profile_id?: string
          push_enabled?: boolean
          social_alerts_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          payload: Json
          profile_id: string
          read_at: string | null
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json
          profile_id: string
          read_at?: string | null
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          profile_id?: string
          read_at?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          created_at: string
          current_team_id: string | null
          date_of_birth: string | null
          full_name: string
          id: string
          known_as: string | null
          nationality: string | null
          position: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_team_id?: string | null
          date_of_birth?: string | null
          full_name: string
          id?: string
          known_as?: string | null
          nationality?: string | null
          position?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_team_id?: string | null
          date_of_birth?: string | null
          full_name?: string
          id?: string
          known_as?: string | null
          nationality?: string | null
          position?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "players_current_team_id_fkey"
            columns: ["current_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_profile_id: string
          body: string
          created_at: string
          fixture_id: string | null
          id: string
          is_edited: boolean
          updated_at: string
        }
        Insert: {
          author_profile_id: string
          body: string
          created_at?: string
          fixture_id?: string | null
          id?: string
          is_edited?: boolean
          updated_at?: string
        }
        Update: {
          author_profile_id?: string
          body?: string
          created_at?: string
          fixture_id?: string | null
          id?: string
          is_edited?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
        ]
      }
      predictions: {
        Row: {
          created_at: string
          fixture_id: string
          id: string
          locked_at: string | null
          points_awarded: number | null
          predicted_outcome: Database["public"]["Enums"]["prediction_outcome"]
          profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          fixture_id: string
          id?: string
          locked_at?: string | null
          points_awarded?: number | null
          predicted_outcome: Database["public"]["Enums"]["prediction_outcome"]
          profile_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          fixture_id?: string
          id?: string
          locked_at?: string | null
          points_awarded?: number | null
          predicted_outcome?: Database["public"]["Enums"]["prediction_outcome"]
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "predictions_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predictions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          clerk_user_id: string
          country: string | null
          created_at: string
          display_name: string | null
          favourite_team_id: string | null
          id: string
          onboarding_completed: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          clerk_user_id: string
          country?: string | null
          created_at?: string
          display_name?: string | null
          favourite_team_id?: string | null
          id?: string
          onboarding_completed?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          clerk_user_id?: string
          country?: string | null
          created_at?: string
          display_name?: string | null
          favourite_team_id?: string | null
          id?: string
          onboarding_completed?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_favourite_team_id_fkey"
            columns: ["favourite_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_mappings: {
        Row: {
          created_at: string
          entity_type: Database["public"]["Enums"]["provider_entity_type"]
          extra: Json
          id: string
          kivo_entity_id: string
          provider: string
          provider_entity_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_type: Database["public"]["Enums"]["provider_entity_type"]
          extra?: Json
          id?: string
          kivo_entity_id: string
          provider: string
          provider_entity_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_type?: Database["public"]["Enums"]["provider_entity_type"]
          extra?: Json
          id?: string
          kivo_entity_id?: string
          provider?: string
          provider_entity_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      reactions: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          reaction_type: Database["public"]["Enums"]["reaction_type"]
          target_id: string
          target_type: Database["public"]["Enums"]["reaction_target_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          reaction_type: Database["public"]["Enums"]["reaction_type"]
          target_id: string
          target_type: Database["public"]["Enums"]["reaction_target_type"]
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          reaction_type?: Database["public"]["Enums"]["reaction_type"]
          target_id?: string
          target_type?: Database["public"]["Enums"]["reaction_target_type"]
        }
        Relationships: [
          {
            foreignKeyName: "reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          id: string
          reason: string
          reporter_profile_id: string
          resolved_at: string | null
          resolved_by_profile_id: string | null
          status: Database["public"]["Enums"]["report_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["moderation_target_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason: string
          reporter_profile_id: string
          resolved_at?: string | null
          resolved_by_profile_id?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["moderation_target_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
          reporter_profile_id?: string
          resolved_at?: string | null
          resolved_by_profile_id?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_id?: string
          target_type?: Database["public"]["Enums"]["moderation_target_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_profile_id_fkey"
            columns: ["reporter_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_resolved_by_profile_id_fkey"
            columns: ["resolved_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          competition_id: string
          created_at: string
          end_date: string | null
          id: string
          is_current: boolean
          name: string
          start_date: string | null
          updated_at: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          end_date?: string | null
          id?: string
          is_current?: boolean
          name: string
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          end_date?: string | null
          id?: string
          is_current?: boolean
          name?: string
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seasons_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      standings: {
        Row: {
          created_at: string
          drawn: number
          goals_against: number
          goals_for: number
          id: string
          lost: number
          played: number
          points: number
          position: number | null
          season_id: string
          team_id: string
          updated_at: string
          won: number
        }
        Insert: {
          created_at?: string
          drawn?: number
          goals_against?: number
          goals_for?: number
          id?: string
          lost?: number
          played?: number
          points?: number
          position?: number | null
          season_id: string
          team_id: string
          updated_at?: string
          won?: number
        }
        Update: {
          created_at?: string
          drawn?: number
          goals_against?: number
          goals_for?: number
          id?: string
          lost?: number
          played?: number
          points?: number
          position?: number | null
          season_id?: string
          team_id?: string
          updated_at?: string
          won?: number
        }
        Relationships: [
          {
            foreignKeyName: "standings_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standings_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          created_at: string
          entity_type: Database["public"]["Enums"]["provider_entity_type"]
          error_message: string | null
          finished_at: string | null
          id: string
          last_synced_at: string | null
          provider: string
          records_processed: number | null
          started_at: string
          status: Database["public"]["Enums"]["sync_status"]
        }
        Insert: {
          created_at?: string
          entity_type: Database["public"]["Enums"]["provider_entity_type"]
          error_message?: string | null
          finished_at?: string | null
          id?: string
          last_synced_at?: string | null
          provider: string
          records_processed?: number | null
          started_at?: string
          status?: Database["public"]["Enums"]["sync_status"]
        }
        Update: {
          created_at?: string
          entity_type?: Database["public"]["Enums"]["provider_entity_type"]
          error_message?: string | null
          finished_at?: string | null
          id?: string
          last_synced_at?: string | null
          provider?: string
          records_processed?: number | null
          started_at?: string
          status?: Database["public"]["Enums"]["sync_status"]
        }
        Relationships: []
      }
      teams: {
        Row: {
          country: string | null
          created_at: string
          crest_url: string | null
          founded_year: number | null
          id: string
          name: string
          short_name: string | null
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          crest_url?: string | null
          founded_year?: number | null
          id?: string
          name: string
          short_name?: string | null
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          crest_url?: string | null
          founded_year?: number | null
          id?: string
          name?: string
          short_name?: string | null
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      user_badges: {
        Row: {
          awarded_at: string
          badge_id: string
          id: string
          profile_id: string
        }
        Insert: {
          awarded_at?: string
          badge_id: string
          id?: string
          profile_id: string
        }
        Update: {
          awarded_at?: string
          badge_id?: string
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_badges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_badges_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          capacity: number | null
          city: string | null
          country: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          capacity?: number | null
          city?: string | null
          country?: string | null
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          capacity?: number | null
          city?: string | null
          country?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      xp_ledger: {
        Row: {
          amount: number
          created_at: string
          id: string
          profile_id: string
          reason: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          profile_id: string
          reason: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          profile_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "xp_ledger_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      ai_message_role: "system" | "user" | "assistant" | "tool"
      delivery_channel: "push" | "email" | "sms" | "in_app"
      delivery_status: "pending" | "sent" | "delivered" | "failed"
      fixture_event_type:
        | "goal"
        | "own_goal"
        | "penalty_goal"
        | "penalty_missed"
        | "yellow_card"
        | "second_yellow_card"
        | "red_card"
        | "substitution"
        | "var_review"
      fixture_status:
        | "scheduled"
        | "live"
        | "halftime"
        | "finished"
        | "postponed"
        | "cancelled"
        | "abandoned"
      follow_target_type: "team" | "player" | "competition" | "user"
      moderation_target_type: "post" | "comment" | "profile"
      prediction_outcome: "home_win" | "draw" | "away_win"
      provider_entity_type:
        | "competition"
        | "season"
        | "team"
        | "player"
        | "manager"
        | "venue"
        | "fixture"
        | "fixture_event"
      reaction_target_type: "post" | "comment"
      reaction_type: "like" | "fire" | "clap" | "laugh" | "wow" | "sad"
      report_status: "pending" | "reviewing" | "actioned" | "dismissed"
      sync_status: "running" | "success" | "partial" | "failed"
      user_role:
        | "user"
        | "moderator"
        | "admin"
        | "super_admin"
        | "football_data_admin"
        | "content_admin"
        | "support_admin"
        | "analyst"
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
      ai_message_role: ["system", "user", "assistant", "tool"],
      delivery_channel: ["push", "email", "sms", "in_app"],
      delivery_status: ["pending", "sent", "delivered", "failed"],
      fixture_event_type: [
        "goal",
        "own_goal",
        "penalty_goal",
        "penalty_missed",
        "yellow_card",
        "second_yellow_card",
        "red_card",
        "substitution",
        "var_review",
      ],
      fixture_status: [
        "scheduled",
        "live",
        "halftime",
        "finished",
        "postponed",
        "cancelled",
        "abandoned",
      ],
      follow_target_type: ["team", "player", "competition", "user"],
      moderation_target_type: ["post", "comment", "profile"],
      prediction_outcome: ["home_win", "draw", "away_win"],
      provider_entity_type: [
        "competition",
        "season",
        "team",
        "player",
        "manager",
        "venue",
        "fixture",
        "fixture_event",
      ],
      reaction_target_type: ["post", "comment"],
      reaction_type: ["like", "fire", "clap", "laugh", "wow", "sad"],
      report_status: ["pending", "reviewing", "actioned", "dismissed"],
      sync_status: ["running", "success", "partial", "failed"],
      user_role: [
        "user",
        "moderator",
        "admin",
        "super_admin",
        "football_data_admin",
        "content_admin",
        "support_admin",
        "analyst",
      ],
    },
  },
} as const
