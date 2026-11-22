package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const sid = "1234567890abcdef1234567890abcdef"

func invoke(t *testing.T, e event, args ...string) string {
	t.Helper()
	data, err := json.Marshal(e)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := run(args, bytes.NewReader(data), &out); err != nil {
		t.Fatal(err)
	}
	return out.String()
}

func TestOpeningAndFollowup(t *testing.T) {
	base := t.TempDir()
	t.Setenv("OPENCRAWL_CONFIG_HOME", base)
	startup := event{Name: "SessionStart", Session: sid, Turn: "first-id", Source: "startup"}
	prompt := event{Name: "UserPromptSubmit", Session: sid, Turn: "second-id", Prompt: "Audit the recovery docs", Source: "user"}
	for _, output := range []string{invoke(t, startup), invoke(t, event{}, "opening", sid)} {
		if !strings.Contains(output, "devin-prompt:first-id") || !strings.Contains(output, "opening user prompt") {
			t.Fatal(output)
		}
	}
	next := invoke(t, prompt)
	if !strings.Contains(next, "devin-prompt:second-id") || strings.Contains(next, prompt.Prompt) {
		t.Fatal(next)
	}
	for _, output := range []string{invoke(t, prompt), invoke(t, startup), invoke(t, event{}, "opening", sid)} {
		if output != "" {
			t.Fatal("stale or duplicate cue", output)
		}
	}
	data, err := os.ReadFile(filepath.Join(base, "opencrawl", "devin-suggestions", "devin-"+sid, "receipt.json"))
	if err != nil || strings.Contains(string(data), prompt.Prompt) {
		t.Fatal("expected IDs only", err)
	}
}

func TestPrivacy(t *testing.T) {
	base := t.TempDir()
	t.Setenv("OPENCRAWL_CONFIG_HOME", base)
	startup := event{Name: "SessionStart", Session: sid, Source: "startup"}
	if invoke(t, startup) == "" {
		t.Fatal("missing startup")
	}
	private := event{Name: "UserPromptSubmit", Session: sid, Turn: "private", Prompt: "/oc-private work", Source: "user"}
	if invoke(t, private) != "" || invoke(t, event{}, "opening", sid) != "" {
		t.Fatal("private session produced a cue")
	}
	private.Prompt = "Explain a past decision"
	private.Turn = "later"
	if invoke(t, private) != "" {
		t.Fatal("privacy lost on next turn")
	}
	t.Setenv("OPENCRAWL_DEVIN_SUGGESTIONS", "off")
	startup.Session = "00000000000000000000000000000000"
	if invoke(t, startup) != "" {
		t.Fatal("disabled startup produced a cue")
	}
}

func TestMissingAndExcludedWork(t *testing.T) {
	base := t.TempDir()
	t.Setenv("OPENCRAWL_CONFIG_HOME", base)
	if invoke(t, event{}, "opening", sid) != "" {
		t.Fatal("fabricated opening cue")
	}
	for _, item := range []event{
		{Name: "SessionStart", Session: sid, Source: "resume"},
		{Name: "UserPromptSubmit", Session: sid, Prompt: "Real words"},
		{Name: "UserPromptSubmit", Session: sid, Prompt: "Real words", Turn: "native", Source: "system"},
		{Name: "SessionStart", Session: "../escaped", Source: "startup"},
	} {
		if invoke(t, item) != "" {
			t.Fatal(item.Name)
		}
	}
	dir := filepath.Join(base, "opencrawl", "capture")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	data := []byte(`{"api":"https://app.getopencrawl.com","installationId":"install","owner":{"tenantId":"one","userId":"member"},"exclusions":{"sessions":["` + sid + `"]}}`)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	if invoke(t, event{Name: "SessionStart", Session: sid, Source: "startup"}) != "" {
		t.Fatal("excluded session produced a cue")
	}
}
