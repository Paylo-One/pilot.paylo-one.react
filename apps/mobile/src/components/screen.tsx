import type { PropsWithChildren, ReactNode } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "@/theme";

interface ScreenProps extends PropsWithChildren {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentContainerStyle?: ScrollViewProps["contentContainerStyle"];
}

export function Screen({
  title,
  eyebrow,
  action,
  children,
  refreshing = false,
  onRefresh,
  contentContainerStyle,
}: ScreenProps) {
  const theme = useAppTheme();
  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          ) : undefined
        }
        contentContainerStyle={[
          styles.content,
          { padding: theme.spacing.md, gap: theme.spacing.md },
          contentContainerStyle,
        ]}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            {eyebrow ? (
              <Text style={[styles.eyebrow, { color: theme.colors.accent }]}>
                {eyebrow.toUpperCase()}
              </Text>
            ) : null}
            <Text
              style={[
                styles.title,
                {
                  color: theme.colors.textPrimary,
                  fontSize: theme.typography.size.h1,
                },
              ]}
            >
              {title}
            </Text>
          </View>
          {action}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingBottom: 120 },
  header: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  headerCopy: { flex: 1, gap: 4 },
  eyebrow: { fontSize: 11, fontWeight: "600", letterSpacing: 1.2 },
  title: { fontWeight: "500", letterSpacing: -0.5 },
});
