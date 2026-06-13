import { queryKeys } from "@management-os/api-client";
import { emptyStateCopy, formatBriefingDate } from "@management-os/ui-core";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";

import { BriefingCard } from "@/components/briefing-card.native";
import { Card } from "@/components/card";
import { MessageCard } from "@/components/message-card";
import { Screen } from "@/components/screen";
import { api, apiConfigured } from "@/lib/api";
import { useAppTheme } from "@/theme";

export default function TodayScreen() {
  const theme = useAppTheme();
  const briefing = useQuery({
    queryKey: queryKeys.briefing.today(),
    queryFn: api.getTodayBriefing,
    enabled: apiConfigured,
  });

  return (
    <Screen
      eyebrow="Management OS"
      title="Today"
      refreshing={briefing.isFetching}
      onRefresh={apiConfigured ? () => void briefing.refetch() : undefined}
    >
      {!apiConfigured ? (
        <MessageCard
          title="API connection ready to configure"
          body="Set EXPO_PUBLIC_API_BASE_URL to a device-reachable Management OS API. The app does not invent briefing data while the mobile endpoints are being implemented."
        />
      ) : briefing.isError ? (
        <MessageCard
          title="Briefing unavailable"
          body={
            briefing.error instanceof Error
              ? briefing.error.message
              : "The briefing could not be loaded."
          }
        />
      ) : briefing.data ? (
        <>
          <Card style={styles.summaryCard}>
            <Text style={[styles.kicker, { color: theme.colors.accent }]}>
              DAILY BRIEFING
            </Text>
            <Text
              style={[styles.summaryTitle, { color: theme.colors.textPrimary }]}
            >
              {briefing.data.title}
            </Text>
            {briefing.data.summary ? (
              <Text
                style={[styles.summary, { color: theme.colors.textSecondary }]}
              >
                {briefing.data.summary}
              </Text>
            ) : null}
            <Text style={[styles.timestamp, { color: theme.colors.textMuted }]}>
              Generated {formatBriefingDate(briefing.data.generatedAt)}
            </Text>
          </Card>
          <View style={styles.sectionHeader}>
            <Text
              style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}
            >
              Priority signals
            </Text>
            <Text style={{ color: theme.colors.textMuted }}>
              {briefing.data.items.length}
            </Text>
          </View>
          {briefing.data.items.length > 0 ? (
            briefing.data.items.map((item) => (
              <BriefingCard key={item.id} item={item} />
            ))
          ) : (
            <MessageCard title="All clear" body={emptyStateCopy.briefing} />
          )}
        </>
      ) : (
        <MessageCard title="Preparing today" body="Loading your briefing..." />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summaryCard: { gap: 10 },
  kicker: { fontSize: 10, fontWeight: "700", letterSpacing: 1.2 },
  summaryTitle: { fontSize: 22, fontWeight: "500", lineHeight: 28 },
  summary: { fontSize: 15, lineHeight: 23 },
  timestamp: { fontSize: 12, marginTop: 4 },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  sectionTitle: { fontSize: 17, fontWeight: "600" },
});
