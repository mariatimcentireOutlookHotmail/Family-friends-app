import { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Button, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../lib/supabase';

type Kind = 'parent' | 'spouse' | 'child' | 'friend';
type Person = { id: string; name: string };
type Connection = { id: string; kind: Kind; related_person_id: string };

const kinds: Kind[] = ['parent', 'spouse', 'child', 'friend'];

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [starting, setStarting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [connectionName, setConnectionName] = useState('');
  const [kind, setKind] = useState<Kind>('parent');
  const [profile, setProfile] = useState<Person | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const activeUser = useRef<string | null>(null);
  const userId = session?.user.id;

  useEffect(() => {
    if (!supabase) {
      setStarting(false);
      return;
    }
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        activeUser.current = nextSession?.user.id ?? null;
        setSession(nextSession);
        setStarting(false);
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const load = useCallback(async () => {
    if (!supabase || !userId) return;
    const [personsResult, relationshipsResult] = await Promise.all([
      supabase.from('people').select('id, name, user_id').order('created_at'),
      supabase.from('relationships').select('id, kind, related_person_id').order('created_at'),
    ]);
    if (activeUser.current !== userId) return;
    if (personsResult.error || relationshipsResult.error) {
      setMessage((personsResult.error || relationshipsResult.error)?.message ?? 'Could not load connections.');
      setLoadedFor(null);
      return;
    }
    const persons = personsResult.data;
    setProfile(persons.find(person => person.user_id === userId) ?? null);
    setPeople(persons);
    setConnections(relationshipsResult.data as Connection[]);
    setLoadedFor(userId);
  }, [userId]);

  useEffect(() => {
    setProfile(null);
    setPeople([]);
    setConnections([]);
    setLoadedFor(null);
    if (userId) void load();
  }, [userId, load]);

  async function authenticate(signUp: boolean) {
    if (!supabase) return;
    setBusy(true);
    setMessage('');
    const result = signUp
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (result.error) setMessage(result.error.message);
    else if (signUp && !result.data.session) setMessage('Check your email to confirm your account, then sign in.');
    setBusy(false);
  }

  async function createProfile() {
    if (!supabase || !session || !name.trim()) return;
    setBusy(true);
    setMessage('');
    const { error } = await supabase.from('people').insert({ name: name.trim(), user_id: session.user.id });
    if (error) setMessage(error.message);
    else {
      setName('');
      await load();
    }
    setBusy(false);
  }

  async function addConnection() {
    if (!supabase || !connectionName.trim()) return;
    setBusy(true);
    setMessage('');
    const { error } = await supabase.rpc('add_connection', {
      connection_name: connectionName.trim(),
      connection_kind: kind,
    });
    if (error) setMessage(error.message);
    else {
      setConnectionName('');
      await load();
    }
    setBusy(false);
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Family & Friends</Text>
        <Text style={styles.subtitle}>Keep the people closest to you connected.</Text>
        {!supabase ? (
          <Text>Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to get started. See the README for setup.</Text>
        ) : starting ? (
          <ActivityIndicator />
        ) : !session ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Sign in or create an account</Text>
            <TextInput accessibilityLabel="Email" placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} />
            <TextInput accessibilityLabel="Password" placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />
            <Button title="Sign in" disabled={busy || !email.trim() || !password} onPress={() => void authenticate(false)} />
            <Button title="Create account" disabled={busy || !email.trim() || !password} onPress={() => void authenticate(true)} />
          </View>
        ) : loadedFor !== userId ? (
          <View style={styles.card}>
            <Text>Loading your connections…</Text>
            <Button title="Retry" onPress={() => void load()} />
            <Button title="Sign out" onPress={() => void supabase?.auth.signOut()} />
          </View>
        ) : !profile ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Create your profile</Text>
            <TextInput accessibilityLabel="Your name" placeholder="Your name" value={name} onChangeText={setName} maxLength={100} style={styles.input} />
            <Button title="Save profile" disabled={busy || !name.trim()} onPress={() => void createProfile()} />
            <Button title="Sign out" onPress={() => void supabase?.auth.signOut()} />
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.heading}>Hello, {profile.name}</Text>
              <Text>Your connections are private to your account for now.</Text>
              <Button title="Sign out" onPress={() => void supabase?.auth.signOut()} />
            </View>
            <View style={styles.card}>
              <Text style={styles.heading}>Add a connection</Text>
              <TextInput accessibilityLabel="Connection name" placeholder="Name" value={connectionName} onChangeText={setConnectionName} maxLength={100} style={styles.input} />
              <Text>Relationship to you</Text>
              <View style={styles.kinds}>
                {kinds.map(option => (
                  <View key={option} style={styles.kind}>
                    <Button title={`${kind === option ? '✓ ' : ''}${option}`} onPress={() => setKind(option)} />
                  </View>
                ))}
              </View>
              <Button title="Add person" disabled={busy || !connectionName.trim()} onPress={() => void addConnection()} />
            </View>
            <View style={styles.card}>
              <Text style={styles.heading}>My connections</Text>
              {connections.length === 0 ? <Text>No connections yet. Add someone above.</Text> : connections.map(connection => (
                <View key={connection.id} style={styles.connection}>
                  <Text style={styles.person}>{people.find(person => person.id === connection.related_person_id)?.name ?? 'Unknown person'}</Text>
                  <Text>{connection.kind}</Text>
                </View>
              ))}
            </View>
          </>
        )}
        {!!message && <Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f7f5' },
  content: { flexGrow: 1, width: '100%', maxWidth: 600, alignSelf: 'center', padding: 24, paddingTop: 64, gap: 16 },
  title: { fontSize: 32, fontWeight: '700', color: '#214c3b' },
  subtitle: { fontSize: 16, color: '#52665c' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 20, gap: 12 },
  heading: { fontSize: 20, fontWeight: '600', color: '#214c3b' },
  input: { borderWidth: 1, borderColor: '#aebfb4', borderRadius: 8, padding: 12 },
  kinds: { flexDirection: 'row', flexWrap: 'wrap' },
  kind: { marginRight: 4 },
  connection: { borderTopWidth: 1, borderColor: '#e1e9e3', paddingTop: 12, gap: 4 },
  person: { fontWeight: '600', fontSize: 16 },
  message: { color: '#a12424' },
});
