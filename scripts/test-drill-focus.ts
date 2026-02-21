/**
 * Test script to verify drill focus_leak distribution
 * 
 * This script generates 10 drills and checks how many focus on the #1 leak
 * Expected: 6-8 out of 10 should have focus_leak = top leak #1 (if leaks exist)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

type DrillScenario = {
  id: string;
  title: string;
  focus_leak: string | null;
  mistake_tag: string;
};

async function testDrillFocus() {
  console.log('🧪 Testing drill focus_leak distribution...\n');

  // First, get the user's top leaks
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    console.error('❌ Not authenticated. Please login first.');
    process.exit(1);
  }

  console.log(`👤 User: ${user.email}`);

  // Get latest leak summary
  const { data: leakData } = await supabase
    .from('leak_summaries')
    .select('summary')
    .eq('user_id', user.id)
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle();

  let topLeakTag: string | null = null;
  if (leakData?.summary?.top_leaks?.[0]) {
    topLeakTag = leakData.summary.top_leaks[0].tag;
    console.log(`🎯 Top Leak: ${topLeakTag}\n`);
    console.log('Available leaks:', leakData.summary.top_leaks.map((l: any) => l.tag).join(', '));
  } else {
    console.log('⚠️  No leak data found. Testing with fundamentals mode.\n');
  }

  // Get user's coach style
  const { data: profileData } = await supabase
    .from('profiles')
    .select('coach_style')
    .eq('id', user.id)
    .single();

  const coachStyle = profileData?.coach_style?.toUpperCase() || 'MENTAL';
  console.log(`🎓 Coach Style: ${coachStyle}\n`);

  console.log('Generating 10 drills...\n');

  const results: { focus_leak: string | null; title: string }[] = [];
  let matchCount = 0;

  for (let i = 1; i <= 10; i++) {
    try {
      const { data, error } = await supabase.functions.invoke('ai-generate-drill', {
        body: { coach_style: coachStyle },
      });

      if (error) {
        console.error(`❌ Drill ${i} failed:`, error);
        continue;
      }

      const scenario = data as DrillScenario;
      results.push({ focus_leak: scenario.focus_leak, title: scenario.title });

      const isMatch = topLeakTag && scenario.focus_leak === topLeakTag;
      if (isMatch) matchCount++;

      const icon = isMatch ? '✅' : '⚪';
      console.log(`${icon} Drill ${i}: ${scenario.focus_leak || 'null'} - "${scenario.title}"`);
    } catch (e) {
      console.error(`❌ Drill ${i} error:`, e);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 RESULTS');
  console.log('='.repeat(60));
  console.log(`Total drills: ${results.length}`);
  
  if (topLeakTag) {
    console.log(`Top leak matches: ${matchCount}/${results.length}`);
    console.log(`Percentage: ${((matchCount / results.length) * 100).toFixed(1)}%`);
    console.log(`Expected: 60-80% (6-8 out of 10)`);
    
    if (matchCount >= 6 && matchCount <= 8) {
      console.log('✅ Distribution is within expected range!');
    } else if (matchCount < 6) {
      console.log('⚠️  Lower than expected. Top leak should appear more often.');
    } else {
      console.log('⚠️  Higher than expected. There should be more variety.');
    }
  } else {
    console.log('All drills should have focus_leak = null (no leak data)');
    const nullCount = results.filter(r => r.focus_leak === null).length;
    console.log(`Null count: ${nullCount}/${results.length}`);
  }

  // Show distribution
  console.log('\n📈 Focus Leak Distribution:');
  const distribution = results.reduce((acc, r) => {
    const key = r.focus_leak || 'null';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])
    .forEach(([leak, count]) => {
      const bar = '█'.repeat(count);
      const pct = ((count / results.length) * 100).toFixed(0);
      console.log(`  ${leak.padEnd(30)} ${bar} ${count} (${pct}%)`);
    });

  console.log('\n✅ Test completed!\n');
}

testDrillFocus().catch(console.error);
