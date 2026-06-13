import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";

import { ActionButton } from "@/components/action-button";
import { Card } from "@/components/card";
import { MessageCard } from "@/components/message-card";
import { Screen } from "@/components/screen";
import { api, apiConfigured, appConfig } from "@/lib/api";
import { requestVoiceCapturePermission } from "@/services/audio";
import { useAppTheme } from "@/theme";

export default function DiaryScreen() {
  const theme = useAppTheme();
  const [body, setBody] = useState("");
  const createEntry = useMutation({
    mutationFn: () => api.createDiaryEntry({ body, kind: "text" }),
    onSuccess: () => {
      setBody("");
      Alert.alert("Captured", "Your private diary note was saved.");
    },
  });

  async function prepareVoiceCapture() {
    const granted = await requestVoiceCapturePermission();
    Alert.alert(
      granted ? "Microphone ready" : "Microphone unavailable",
      granted
        ? "Voice-note upload and transcription remain behind the diaryVoiceCapture feature flag."
        : "Enable microphone access in system settings to prepare voice notes.",
    );
  }

  return (
    <Screen eyebrow="Private by default" title="Diary capture">
      <Card style={styles.composer}>
        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
          What should the system remember?
        </Text>
        <TextInput
          multiline
          onChangeText={setBody}
          placeholder="Capture a decision, observation, or loose thread..."
          placeholderTextColor={theme.colors.textMuted}
          style={[
            styles.input,
            {
              backgroundColor: theme.colors.surfaceSunken,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.md,
              color: theme.colors.textPrimary,
            },
          ]}
          textAlignVertical="top"
          value={body}
        />
        <View style={styles.actions}>
          <ActionButton
            label="Save note"
            icon="arrow-up-outline"
            variant="primary"
            loading={createEntry.isPending}
            disabled={!apiConfigured || body.trim().length === 0}
            onPress={() => createEntry.mutate()}
          />
          <ActionButton
            label="Prepare voice"
            icon="mic-outline"
            disabled={!appConfig.featureFlags.diaryVoiceCapture}
            onPress={() => void prepareVoiceCapture()}
          />
        </View>
      </Card>
      {!apiConfigured ? (
        <MessageCard
          title="Capture contract ready"
          body="Text entry submission will activate when EXPO_PUBLIC_API_BASE_URL is set. Notes are not stored locally as a misleading substitute."
        />
      ) : null}
      <Text style={[styles.privacy, { color: theme.colors.textMuted }]}>
        Diary content is author-scoped. Voice capture is scaffolded but disabled
        until upload, retention, and transcription policies are connected.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  composer: { gap: 12 },
  label: { fontSize: 14, fontWeight: "500" },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    lineHeight: 24,
    minHeight: 180,
    padding: 14,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  privacy: { fontSize: 12, lineHeight: 18 },
});
