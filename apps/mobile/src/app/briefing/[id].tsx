import { queryKeys } from "@management-os/api-client";
import type {
  BriefingFeedback,
  BriefingItemStatus,
} from "@management-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Alert, Linking, StyleSheet, Text, View } from "react-native";

import { ActionButton } from "@/components/action-button";
import { Card } from "@/components/card";
import { MessageCard } from "@/components/message-card";
import { Screen } from "@/components/screen";
import { api, apiConfigured } from "@/lib/api";
import { useAppTheme } from "@/theme";

export default function BriefingDetailScreen() {
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const item = useQuery({
    queryKey: queryKeys.briefing.item(id ?? ""),
    queryFn: () => api.getBriefingItem(id!),
    enabled: apiConfigured && Boolean(id),
  });

  const statusMutation = useMutation({
    mutationFn: (status: BriefingItemStatus) =>
      api.updateBriefingItemStatus(id!, status),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.briefing.item(id!), updated);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.briefing.today(),
      });
    },
  });

  const feedbackMutation = useMutation({
    mutationFn: (feedback: BriefingFeedback) =>
      api.submitBriefingFeedback(id!, feedback),
    onSuccess: () =>
      Alert.alert("Feedback noted", "This will tune future ranking."),
  });

  if (!apiConfigured) {
    return (
      <Screen title="Briefing item">
        <MessageCard
          title="API not configured"
          body="Set EXPO_PUBLIC_API_BASE_URL to load this item."
        />
      </Screen>
    );
  }

  if (!item.data) {
    return (
      <Screen title="Briefing item">
        <MessageCard
          title={item.isError ? "Item unavailable" : "Loading item"}
          body={
            item.error instanceof Error
              ? item.error.message
              : "Fetching the signal and its context."
          }
        />
      </Screen>
    );
  }

  return (
    <Screen eyebrow={item.data.priority} title={item.data.title}>
      <Card style={styles.card}>
        {item.data.summary ? (
          <Text style={[styles.summary, { color: theme.colors.textPrimary }]}>
            {item.data.summary}
          </Text>
        ) : null}
        {item.data.whyItMatters ? (
          <View style={styles.block}>
            <Text style={[styles.label, { color: theme.colors.accent }]}>
              WHY IT MATTERS
            </Text>
            <Text style={[styles.body, { color: theme.colors.textSecondary }]}>
              {item.data.whyItMatters}
            </Text>
          </View>
        ) : null}
        <Text style={[styles.meta, { color: theme.colors.textMuted }]}>
          {item.data.sourceName ?? item.data.sourceType}
        </Text>
        {item.data.sourceUrl ? (
          <ActionButton
            label="Open original source"
            icon="open-outline"
            onPress={() => void Linking.openURL(item.data.sourceUrl!)}
          />
        ) : null}
      </Card>

      <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>
        Decision
      </Text>
      <View style={styles.actions}>
        <ActionButton
          label="Approve"
          icon="checkmark-outline"
          variant="primary"
          loading={statusMutation.isPending}
          onPress={() => statusMutation.mutate("approved")}
        />
        <ActionButton
          label="Snooze"
          icon="time-outline"
          onPress={() => statusMutation.mutate("snoozed")}
        />
        <ActionButton
          label="Dismiss"
          icon="close-outline"
          variant="danger"
          onPress={() => statusMutation.mutate("dismissed")}
        />
      </View>

      <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>
        Tune future briefings
      </Text>
      <View style={styles.actions}>
        <ActionButton
          label="More like this"
          icon="add-circle-outline"
          loading={feedbackMutation.isPending}
          onPress={() => feedbackMutation.mutate("more_like_this")}
        />
        <ActionButton
          label="Less like this"
          icon="remove-circle-outline"
          onPress={() => feedbackMutation.mutate("less_like_this")}
        />
        <ActionButton
          label="Important"
          icon="star-outline"
          onPress={() => feedbackMutation.mutate("important")}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 18 },
  summary: { fontSize: 17, lineHeight: 25 },
  block: { gap: 6 },
  label: { fontSize: 10, fontWeight: "700", letterSpacing: 1.1 },
  body: { fontSize: 14, lineHeight: 21 },
  meta: { fontSize: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "600", marginTop: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
