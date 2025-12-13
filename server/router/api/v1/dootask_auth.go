package v1

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/pkg/errors"
	"golang.org/x/crypto/bcrypt"

	"github.com/usememos/memos/internal/util"
	"github.com/usememos/memos/store"
)

type dooTaskAPIResponse struct {
	Ret  int             `json:"ret"`
	Msg  string          `json:"msg"`
	Data json.RawMessage `json:"data"`
}

type dooTaskUserInfo struct {
	UserID   int32    `json:"userid"`
	Identity []string `json:"identity"`
	Email    string   `json:"email"`
	Nickname string   `json:"nickname"`
	UserImg  string   `json:"userimg"`
}

func containsString(list []string, value string) bool {
	for _, v := range list {
		if v == value {
			return true
		}
	}
	return false
}

func getDooTaskServerURL() string {
	if v := strings.TrimSpace(os.Getenv("DOOTASK_SERVER")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "http://nginx"
}

func fetchDooTaskUserInfo(ctx context.Context, token string) (*dooTaskUserInfo, error) {
	server := getDooTaskServerURL()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server+"/api/users/info", nil)
	if err != nil {
		return nil, errors.Wrap(err, "failed to build dootask request")
	}
	req.Header.Set("Token", token)
	req.Header.Set("User-Agent", "memos-dootask-plugin")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.Wrap(err, "failed to request dootask api")
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, errors.Wrap(err, "failed to read dootask response")
	}

	var apiResp dooTaskAPIResponse
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, errors.Wrap(err, "failed to parse dootask response")
	}
	if apiResp.Ret != 1 {
		if apiResp.Msg != "" {
			return nil, errors.New(apiResp.Msg)
		}
		return nil, errors.Errorf("dootask api error: %d", apiResp.Ret)
	}

	var userInfo dooTaskUserInfo
	if err := json.Unmarshal(apiResp.Data, &userInfo); err != nil {
		return nil, errors.Wrap(err, "failed to parse dootask user info")
	}
	if userInfo.UserID <= 0 {
		return nil, errors.New("dootask user is not logged in")
	}
	return &userInfo, nil
}

func resolveDooTaskUserRole(ctx context.Context, st *store.Store, identity []string) (store.Role, error) {
	if !containsString(identity, "admin") {
		return store.RoleUser, nil
	}

	hostRole := store.RoleHost
	owner, err := st.GetUser(ctx, &store.FindUser{Role: &hostRole})
	if err != nil {
		return "", errors.Wrap(err, "failed to lookup memos host user")
	}
	if owner == nil {
		return store.RoleHost, nil
	}
	return store.RoleAdmin, nil
}

func buildDooTaskUsername(userID int32) string {
	// Note: username validation for public signup uses UIDMatcher; this DooTask integration
	// is intended for plugin-only auto provisioning and uses a stable mapping.
	return fmt.Sprintf("dt_%d", userID)
}

func buildOriginPlaceholderPath(path string) string {
	if path == "" {
		return ""
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return "{origin}" + path
}

func normalizeDooTaskAvatarURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}

	u, err := url.Parse(raw)
	if err != nil {
		// Fall back to storing a root-relative path placeholder if it looks like a path.
		if strings.HasPrefix(raw, "/") {
			return buildOriginPlaceholderPath(raw)
		}
		return raw
	}

	// If the value is a (root-)relative path, store it with origin placeholder to avoid base path prefixing.
	if u.Scheme == "" && u.Host == "" {
		if strings.HasPrefix(raw, "/") {
			return buildOriginPlaceholderPath(u.Path)
		}
		// Relative path without leading slash - keep as-is.
		return raw
	}

	if u.Path == "" {
		return ""
	}
	return buildOriginPlaceholderPath(u.Path)
}

func (s *APIV1Service) authenticateByDooTask(ctx context.Context, token string) (*store.User, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, errors.New("empty dootask token")
	}

	userInfo, err := fetchDooTaskUserInfo(ctx, token)
	if err != nil {
		return nil, err
	}

	username := buildDooTaskUsername(userInfo.UserID)
	roleToAssign, err := resolveDooTaskUserRole(ctx, s.Store, userInfo.Identity)
	if err != nil {
		return nil, err
	}

	user, err := s.Store.GetUser(ctx, &store.FindUser{Username: &username})
	if err != nil {
		return nil, errors.Wrap(err, "failed to lookup memos user")
	}

	email := strings.TrimSpace(userInfo.Email)
	nickname := strings.TrimSpace(userInfo.Nickname)
	if nickname == "" {
		nickname = username
	}
	avatarURL := normalizeDooTaskAvatarURL(userInfo.UserImg)

	if user == nil {
		password, err := util.RandomString(20)
		if err != nil {
			return nil, errors.Wrap(err, "failed to generate password")
		}
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			return nil, errors.Wrap(err, "failed to generate password hash")
		}

		userCreate := &store.User{
			Username:     username,
			Role:         roleToAssign,
			Email:        email,
			Nickname:     nickname,
			AvatarURL:    avatarURL,
			PasswordHash: string(passwordHash),
		}
		created, err := s.Store.CreateUser(ctx, userCreate)
		if err != nil {
			return nil, errors.Wrap(err, "failed to create memos user")
		}
		return created, nil
	}

	update := &store.UpdateUser{ID: user.ID}

	// Role is synchronized from DooTask, but never demote HOST.
	if user.Role != store.RoleHost && user.Role != roleToAssign {
		update.Role = &roleToAssign
	}
	if email != "" && email != user.Email {
		update.Email = &email
	}
	if nickname != "" && nickname != user.Nickname {
		update.Nickname = &nickname
	}
	if avatarURL != "" && avatarURL != user.AvatarURL {
		update.AvatarURL = &avatarURL
	}

	if update.Role != nil || update.Email != nil || update.Nickname != nil || update.AvatarURL != nil {
		updated, err := s.Store.UpdateUser(ctx, update)
		if err != nil {
			return nil, errors.Wrap(err, "failed to update memos user")
		}
		return updated, nil
	}

	return user, nil
}
