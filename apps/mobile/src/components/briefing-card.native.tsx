import type { BriefingItem } from "@management-os/domain";
import { priorityLabels } from "@management-os/ui-core";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/card";
import { useAppTheme } from "@/theme";

export function BriefingCard({ item }: { item: BriefingItem }) {
  const theme = useAppTheme();
  return (
    <Link href={`/briefing/${item.id}`} asChild>
      <Pressable>
        <Card style={styles.card}>
          <View style={styles.meta}>
            <Text style={[styles.priority, { color: theme.colors.accent }]}>
              {priorityLabels[item.priority].toUpperCase()}
            </Text>
            <Text style={[styles.source, { color: theme.colors.textMuted }]}>
              {item.sourceName ?? item.sourceType}
            </Text>
          </View>
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
            {item.title}
          </Text>
          {item.summary ? (
            <Text
              style={[styles.summary, { color: theme.colors.textSecondary }]}
            >
              {item.summary}
            </Text>
          ) : null}
        </Card>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  meta: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  priority: { fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  source: { fontSize: 12 },
  title: { fontSize: 17, fontWeight: "600", lineHeight: 23 },
  summary: { fontSize: 14, lineHeight: 21 },
});
