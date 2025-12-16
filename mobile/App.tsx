import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { API_URL, extractLeaseTerms, LeaseExtraction, LeaseTerm } from './src/api';

// Long edge in pixels. Large enough to keep small lease print legible,
// small enough to keep uploads fast.
const MAX_EDGE = 2000;

const CATEGORY_LABELS: Record<string, string> = {
  parties: 'Parties',
  premises: 'Premises',
  term_and_dates: 'Term & Dates',
  rent: 'Rent',
  escalations: 'Escalations',
  security_deposit: 'Security Deposit',
  operating_expenses: 'Operating Expenses / CAM',
  permitted_use: 'Permitted Use',
  maintenance_and_repairs: 'Maintenance & Repairs',
  insurance_and_indemnity: 'Insurance & Indemnity',
  renewal_and_options: 'Renewal & Options',
  termination_and_default: 'Termination & Default',
  assignment_and_subletting: 'Assignment & Subletting',
  other: 'Other',
};

type Status = 'idle' | 'loading' | 'done' | 'error';

export default function App() {
  return (
    <SafeAreaProvider>
      <LeaseScanner />
    </SafeAreaProvider>
  );
}

function LeaseScanner() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<LeaseExtraction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickImage(source: 'camera' | 'library') {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', `Allow ${source} access to scan a lease page.`);
      return;
    }

    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
    const picked =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    if (picked.canceled || !picked.assets[0]) return;

    await analyze(picked.assets[0]);
  }

  async function analyze(asset: ImagePicker.ImagePickerAsset) {
    setImageUri(asset.uri);
    setResult(null);
    setError(null);
    setStatus('loading');

    try {
      const resize =
        asset.width >= asset.height
          ? { width: Math.min(asset.width, MAX_EDGE) }
          : { height: Math.min(asset.height, MAX_EDGE) };
      const rendered = await ImageManipulator.manipulate(asset.uri).resize(resize).renderAsync();
      const saved = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: 0.8,
        base64: true,
      });
      if (!saved.base64) throw new Error('Could not encode image.');

      setResult(await extractLeaseTerms(saved.base64));
      setStatus('done');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(
        message === 'Network request failed'
          ? `Could not reach the server at ${API_URL}. Is it running and on the same network?`
          : message,
      );
      setStatus('error');
    }
  }

  function reset() {
    setImageUri(null);
    setResult(null);
    setError(null);
    setStatus('idle');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Leasely</Text>
        <Text style={styles.subtitle}>
          Snap a page of a commercial lease to pull out its key terms.
        </Text>

        <View style={styles.buttonRow}>
          <Button
            label="Scan page"
            onPress={() => pickImage('camera')}
            disabled={status === 'loading'}
          />
          <Button
            label="Choose photo"
            variant="secondary"
            onPress={() => pickImage('library')}
            disabled={status === 'loading'}
          />
        </View>

        {imageUri && <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="contain" />}

        {status === 'loading' && (
          <View style={styles.loading}>
            <ActivityIndicator size="large" />
            <Text style={styles.muted}>Reading the page…</Text>
          </View>
        )}

        {status === 'error' && error && (
          <View style={[styles.card, styles.errorCard]}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {status === 'done' && result && <Results result={result} />}

        {status !== 'idle' && status !== 'loading' && (
          <Pressable onPress={reset} style={styles.resetLink}>
            <Text style={styles.link}>Start over</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Results({ result }: { result: LeaseExtraction }) {
  const grouped = new Map<string, LeaseTerm[]>();
  for (const term of result.terms) {
    const list = grouped.get(term.category) ?? [];
    list.push(term);
    grouped.set(term.category, list);
  }
  const orderedCategories = Object.keys(CATEGORY_LABELS).filter((c) => grouped.has(c));

  return (
    <View>
      {!result.is_lease_document && (
        <View style={[styles.card, styles.warnCard]}>
          <Text style={styles.warnText}>This doesn’t look like a lease page.</Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Page summary</Text>
        <Text style={styles.body}>{result.page_summary}</Text>
      </View>

      {result.warnings.length > 0 && (
        <View style={[styles.card, styles.warnCard]}>
          {result.warnings.map((w, i) => (
            <Text key={i} style={styles.warnText}>
              ⚠︎ {w}
            </Text>
          ))}
        </View>
      )}

      {result.terms.length === 0 && (
        <Text style={[styles.muted, { textAlign: 'center' }]}>No terms found on this page.</Text>
      )}

      {orderedCategories.map((category) => (
        <View key={category} style={styles.card}>
          <Text style={styles.sectionLabel}>{CATEGORY_LABELS[category]}</Text>
          {grouped.get(category)!.map((term, i) => (
            <TermRow key={i} term={term} />
          ))}
        </View>
      ))}
    </View>
  );
}

function TermRow({ term }: { term: LeaseTerm }) {
  const [showSource, setShowSource] = useState(false);
  return (
    <Pressable onPress={() => setShowSource((s) => !s)} style={styles.term}>
      <Text style={styles.termLabel}>{term.label}</Text>
      <Text style={styles.body}>{term.value}</Text>
      {showSource ? (
        <Text style={styles.source}>“{term.source_text}”</Text>
      ) : (
        <Text style={styles.link}>Show source text</Text>
      )}
    </Pressable>
  );
}

function Button({
  label,
  onPress,
  disabled,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.buttonPrimary : styles.buttonSecondary,
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      <Text style={[styles.buttonText, !primary && { color: '#1f3a5f' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f5f7' },
  content: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 32, fontWeight: '700', color: '#1f3a5f' },
  subtitle: { fontSize: 15, color: '#555', marginTop: 4, marginBottom: 20 },
  buttonRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  button: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  buttonPrimary: { backgroundColor: '#1f3a5f' },
  buttonSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#1f3a5f' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  preview: {
    width: '100%',
    height: 260,
    borderRadius: 10,
    backgroundColor: '#e3e6ea',
    marginBottom: 16,
  },
  loading: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1f3a5f',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  term: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ddd' },
  termLabel: { fontSize: 15, fontWeight: '600', color: '#222', marginBottom: 2 },
  body: { fontSize: 15, color: '#333', lineHeight: 21 },
  source: { fontSize: 13, color: '#666', fontStyle: 'italic', marginTop: 6 },
  link: { fontSize: 13, color: '#2b6cb0', marginTop: 6 },
  muted: { color: '#777' },
  warnCard: { backgroundColor: '#fff8e6' },
  warnText: { color: '#7a5a00', fontSize: 14, lineHeight: 20 },
  errorCard: { backgroundColor: '#fdecec' },
  errorText: { color: '#9b1c1c', fontSize: 14 },
  resetLink: { alignItems: 'center', marginTop: 8 },
});
