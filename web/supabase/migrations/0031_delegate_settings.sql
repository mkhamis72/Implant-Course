-- Delegate logins need the idle timeout (layout and middleware read settings); nothing in it is sensitive.
alter policy settings_select on public.settings
  using (public.is_active_user() or public.is_delegate_user());
