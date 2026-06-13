import { StyleSheet, Text } from "react-native";

import { Card } from "@/components/card";
import { useAppTheme } from "@/theme";

export function MessageCard({ title, body }: { title: string; body: string }) {
  const theme = useAppTheme();
  return (
    <Card style={styles.card}>
      <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
        {title}
      </Text>
      <Text style={[styles.body, { color: theme.colors.textSecondary }]}>
        {body}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  title: { fontSize: 16, fontWeight: "600" },
  body: { fontSize: 14, lineHeight: 21 },
});
