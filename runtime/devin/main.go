// The stock Cloud VM runs this hook without a Node installation or a CLI login.
// Only Devin's authenticated MCP tool reads workspace data.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

const api = "https://app.getopencrawl.com"

var nativeSession = regexp.MustCompile("^(?:devin-)?([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$")
var nativeTurn = regexp.MustCompile("^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$")
var privacy = regexp.MustCompile(`(?i)^\s*(?:(?:please )?(?:use|activate|enable) )?(?:\[?\$|/)(?:opencrawl(?:-[a-f0-9]{12})?:)?(?:oc-incognito|oc-private|opencrawl-private|oc-readonly)(?:\s|\]|$)`)

type event struct {
	Name    string `json:"hook_event_name"`
	Tool    string `json:"tool_name"`
	Session string `json:"session_id"`
	Turn    string `json:"prompt_id"`
	Source  string `json:"source"`
	Prompt  string `json:"prompt"`
	Cwd     string `json:"cwd"`
}
type receipt struct {
	Opening         string `json:"opening,omitempty"`
	Latest          string `json:"latest,omitempty"`
	Private         bool   `json:"private,omitempty"`
	OpeningHook     string `json:"openingHook,omitempty"`
	LatestHook      string `json:"latestHook,omitempty"`
	OpeningReminder bool   `json:"openingReminder,omitempty"`
}
type enrollment struct {
	API          string `json:"api"`
	Installation string `json:"installationId"`
	Owner        struct {
		Tenant string `json:"tenantId"`
		User   string `json:"userId"`
	} `json:"owner"`
	Exclusions struct{ Projects, Sessions []string } `json:"exclusions"`
}

func digest(s string) string            { sum := sha256.Sum256([]byte(s)); return hex.EncodeToString(sum[:]) }
func arrayHash(values ...string) string { b, _ := json.Marshal(values); return digest(string(b)) }
func readJSON(path string, dest any) (bool, error) {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 65537))
	if err != nil || len(data) > 65536 {
		return false, errors.New("invalid local settings")
	}
	return true, json.Unmarshal(data, dest)
}
func within(base, path string) bool {
	rel, err := filepath.Rel(base, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}
func allowed(profile, sid, cwd string) bool {
	var config enrollment
	exists, err := readJSON(filepath.Join(profile, "capture", "config.json"), &config)
	if err != nil {
		return false
	}
	if !exists {
		return true
	}
	if config.API != api || config.Owner.Tenant == "" || config.Owner.User == "" || config.Installation == "" {
		return false
	}
	for _, id := range config.Exclusions.Sessions {
		if id == sid || id == strings.TrimPrefix(sid, "devin-") {
			return false
		}
	}
	for _, project := range config.Exclusions.Projects {
		if !filepath.IsAbs(cwd) || !filepath.IsAbs(project) {
			return false
		}
		a, errA := filepath.EvalSymlinks(cwd)
		b, errB := filepath.EvalSymlinks(project)
		if errA != nil || errB != nil || within(b, a) || within(a, b) {
			return false
		}
	}
	for _, id := range []string{sid, strings.TrimPrefix(sid, "devin-")} {
		for _, stage := range []string{"pending", "accepted"} {
			_, err := os.Stat(filepath.Join(profile, "capture", "incognito", arrayHash(api, config.Owner.Tenant, config.Owner.User), stage, arrayHash("devin", id)+".json"))
			if !errors.Is(err, os.ErrNotExist) {
				return false
			}
		}
	}
	return true
}

func cue(sid, id string, opening bool) string {
	turn := "the new user prompt"
	if opening {
		turn = "the opening user prompt only; ignore this cue on later turns"
	}
	return fmt.Sprintf("OpenCrawl context suggestion for %s. For substantive workspace work, call opencrawl_context_suggestions_v1 once through the signed-in member's OpenCrawl MCP, with sessionId %q, eventId %q and a short non-sensitive topic from the current request. Skip private or excluded work, requests to avoid search, trivial tasks, or a turn already checked. Use relevant returned source evidence and cite it. If empty or unavailable, continue.", turn, sid, id)
}

func run(args []string, input io.Reader, output io.Writer) error {
	var e event
	mode := "hook"
	if len(args) == 0 {
		body, err := io.ReadAll(io.LimitReader(input, 131073))
		if err != nil || len(body) > 131072 {
			return nil
		}
		if err = json.Unmarshal(body, &e); err != nil {
			return nil
		}
	} else {
		if args[0] != "opening" || (len(args) != 2 && len(args) != 3) {
			return errors.New("usage: opencrawl-context opening SESSION_ID [PRIVATE_COMMAND]")
		}
		if len(args) == 3 {
			if !privacy.MatchString(args[2]) {
				return errors.New("expected a private-session command")
			}
			e.Prompt = args[2]
		}
		mode = args[0]
		e.Session = args[1]
	}
	match := nativeSession.FindStringSubmatch(e.Session)
	if match == nil {
		return nil
	}
	sid := "devin-" + strings.ReplaceAll(match[1], "-", "")
	if mode == "hook" && e.Name != "UserPromptSubmit" && e.Name != "PostToolUse" && (e.Name != "SessionStart" || e.Source != "startup") {
		return nil
	}
	if e.Turn != "" && !nativeTurn.MatchString(e.Turn) {
		return nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	base := os.Getenv("OPENCRAWL_CONFIG_HOME")
	if base == "" {
		base = os.Getenv("XDG_CONFIG_HOME")
	}
	if base == "" {
		base = filepath.Join(home, ".config")
	}
	if !filepath.IsAbs(base) {
		return nil
	}
	profile := filepath.Join(base, "opencrawl")
	if e.Cwd == "" {
		e.Cwd = os.Getenv("DEVIN_PROJECT_DIR")
	}
	dir := filepath.Join(profile, "devin-suggestions", sid)
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	lock, err := os.OpenFile(filepath.Join(dir, "lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	path := filepath.Join(dir, "receipt.json")
	var state receipt
	if _, err = readJSON(path, &state); err != nil {
		return err
	}
	before := state
	var id string
	switch {
	case privacy.MatchString(e.Prompt):
		state.Private = true
	case state.Private || !allowed(profile, sid, e.Cwd):
		return nil
	case mode == "opening":
		if state.Opening != "" && state.Opening == state.Latest {
			id = state.Opening
		}
	case e.Name == "PostToolUse":
		// SessionStart may arrive after the model has begun its opening task.
		// Re-deliver its existing turn reference once after a real tool completes.
		if e.Tool == "" || e.Tool == "message_user" || e.Turn == "" || state.OpeningReminder ||
			state.Opening != state.Latest || state.Opening != "devin-prompt:"+e.Turn {
			return nil
		}
		id = state.Opening
		state.OpeningReminder = true
	case e.Name == "SessionStart":
		if state.Latest != "" {
			return nil
		}
		id = "devin-opening"
		if e.Turn != "" {
			id = "devin-prompt:" + e.Turn
		}
		state.Opening = id
		state.OpeningHook = e.Name
		state.LatestHook = e.Name
		state.Latest = id
	case e.Name == "UserPromptSubmit" && (e.Source == "" || e.Source == "user") && e.Turn != "" && strings.TrimSpace(e.Prompt) != "":
		id = "devin-prompt:" + e.Turn
		if id == state.Latest {
			return nil
		}
		if state.Latest == "" {
			state.Opening = id
			state.OpeningHook = e.Name
		}
		state.LatestHook = e.Name
		state.Latest = id
	default:
		return nil
	}
	if before != state {
		data, err := json.Marshal(state)
		if err != nil {
			return err
		}
		tmp, err := os.CreateTemp(dir, ".receipt-")
		if err != nil {
			return err
		}
		defer os.Remove(tmp.Name())
		_, err = tmp.Write(data)
		closeErr := tmp.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		if err = os.Rename(tmp.Name(), path); err != nil {
			return err
		}
	}
	if id == "" {
		return nil
	}
	msg := cue(sid, id, state.Opening == id)
	if mode == "opening" {
		_, err = fmt.Fprintln(output, msg)
		return err
	}
	return json.NewEncoder(output).Encode(map[string]any{"hookSpecificOutput": map[string]string{"hookEventName": e.Name, "additionalContext": msg}})
}
func main() {
	if len(os.Args) == 3 && os.Args[1] == "opening" {
		// Cloud runs SessionStart in the background. Give it a bounded chance to
		// publish its IDs; disabled hooks and resumed turns stay silent.
		for i := 0; i < 6; i++ {
			var out strings.Builder
			if run(os.Args[1:], os.Stdin, &out) != nil {
				return
			}
			if out.Len() != 0 {
				fmt.Print(out.String())
				return
			}
			if i < 5 {
				time.Sleep(200 * time.Millisecond)
			}
		}
		return
	}
	if err := run(os.Args[1:], os.Stdin, os.Stdout); err != nil && len(os.Args) > 1 {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
}
