import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://zyyijlvmgoanjdzngmon.supabase.co";
export const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5eWlqbHZtZ29hbmpkem5nbW9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNDI1NzMsImV4cCI6MjA4ODkxODU3M30.k2WWIg_7STiIOPSGojZ2zH_QCShvvSw8Ax0hk1yGjOI";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
