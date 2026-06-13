import Ionicons from "@expo/vector-icons/Ionicons";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
} from "react-native";

import { useAppTheme } from "@/theme";

interface ActionButtonProps extends PressableProps {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
}

export function ActionButton({
  label,
  icon,
  variant = "secondary",
  loading = false,
  disabled,
  style,
  ...props
}: ActionButtonProps) {
  const theme = useAppTheme();
  const primary = variant === "primary";
  const danger = variant === "danger";
  const backgroundColor = primary
    ? theme.colors.accent
    : danger
      ? theme.colors.dangerTint
      : theme.colors.surfaceSunken;
  const color = primary
    ? theme.colors.accentOn
    : danger
      ? theme.colors.danger
      : theme.colors.textPrimary;

  return (
    <Pressable
      {...props}
      disabled={disabled || loading}
      style={(state) => [
        styles.button,
        {
          backgroundColor,
          borderRadius: theme.radius.md,
          opacity: disabled || loading ? 0.5 : state.pressed ? 0.75 : 1,
        },
        typeof style === "function" ? style(state) : style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} size="small" />
      ) : icon ? (
        <Ionicons name={icon} color={color} size={17} />
      ) : null}
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  label: { fontSize: 13, fontWeight: "600" },
});
