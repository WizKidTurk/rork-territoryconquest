import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";

type Props = { children: React.ReactNode };

type State = { hasError: boolean; error: Error | null; errorInfo: string };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: "" };
  
  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }
  
  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.log("🔴 ErrorBoundary caught:", error?.message);
    console.log("🔴 Component stack:", info?.componentStack);
    this.setState({ errorInfo: info?.componentStack ?? "" });
  }
  
  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: "" });
  };
  
  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container} testID="error-boundary">
          <Text style={styles.emoji}>⚠️</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.subtitle}>Please try again or restart the app</Text>
          
          <ScrollView style={styles.errorBox} contentContainerStyle={styles.errorContent}>
            <Text style={styles.errorLabel}>Error:</Text>
            <Text style={styles.errorText}>{this.state.error?.message ?? "Unknown error"}</Text>
            {this.state.errorInfo ? (
              <>
                <Text style={[styles.errorLabel, { marginTop: 12 }]}>Stack:</Text>
                <Text style={styles.stackText}>{this.state.errorInfo.slice(0, 500)}</Text>
              </>
            ) : null}
          </ScrollView>
          
          <TouchableOpacity style={styles.retryBtn} onPress={this.handleRetry}>
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children as React.ReactElement;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#0B1220" },
  emoji: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 8, color: "#fff" },
  subtitle: { fontSize: 14, color: "#9CA3AF", marginBottom: 20 },
  errorBox: { maxHeight: 200, width: "100%", backgroundColor: "rgba(239,68,68,0.1)", borderRadius: 12, borderWidth: 1, borderColor: "#EF4444" },
  errorContent: { padding: 12 },
  errorLabel: { fontSize: 12, fontWeight: "700", color: "#EF4444", marginBottom: 4 },
  errorText: { fontSize: 13, color: "#FCA5A5", fontFamily: "monospace" },
  stackText: { fontSize: 11, color: "#9CA3AF", fontFamily: "monospace" },
  retryBtn: { marginTop: 20, backgroundColor: "#3B82F6", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  retryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
