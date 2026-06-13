import { queryKeys } from "@management-os/api-client";
import { emptyStateCopy } from "@management-os/ui-core";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/card";
import { MessageCard } from "@/components/message-card";
import { Screen } from "@/components/screen";
import { api, apiConfigured } from "@/lib/api";
import { useAppTheme } from "@/theme";

export default function SourcesScreen() {
  const theme = useAppTheme();
  const sources = useQuery({
    queryKey: queryKeys.sources.status(),
    queryFn: api.getConnectedSourcesStatus,
    enabled: apiConfigured,
  });

  return (
    <Screen
      eyebrow="Signal health"
      title="Sources"
      refreshing={sources.isFetching}
      onRefresh={apiConfigured ? () => void sources.refetch() : undefined}
    >
      {!apiConfigured ? (
        <MessageCard
          title="Source status placeholder"
          body="Connection health will use the shared connected-source contract once the mobile status endpoint exists."
        />
      ) : sources.data?.length ? (
        sources.data.map((source) => {
          const statusColor =
            source.status === "connected"
              ? theme.colors.success
              : source.status === "attention"
                ? theme.colors.warning
                : theme.colors.danger;
          return (
            <Card key={source.id} style={styles.card}>
              <View style={styles.row}>
                <View style={[styles.dot, { backgroundColor: statusColor }]} />
                <View style={styles.copy}>
                  <Text
                    style={[styles.title, { color: theme.colors.textPrimary }]}
                  >
                    {source.displayName}
                  </Text>
                  <Text
                    style={[
                      styles.detail,
                      { color: theme.colors.textSecondary },
                    ]}
                  >
                    {source.detail ?? source.status}
                  </Text>
                </View>
              </View>
            </Card>
          );
        })
      ) : (
        <MessageCard
          title={sources.isError ? "Source status unavailable" : "No sources"}
          body={
            sources.error instanceof Error
              ? sources.error.message
              : emptyStateCopy.sources
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  row: { alignItems: "center", flexDirection: "row", gap: 12 },
  dot: { borderRadius: 999, height: 8, width: 8 },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: "600" },
  detail: { fontSize: 13, lineHeight: 18 },
});
