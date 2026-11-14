"use client";

import { useActionState, useState } from "react";
import { ImagePlus, LoaderCircle, Sparkles } from "lucide-react";
import { saveProfile, type ActionState } from "@/app/actions/auth";

function ProfileAvatarUpload({ initialAvatarUrl }: { initialAvatarUrl: string | null }) {
  const [previewUrl, setPreviewUrl] = useState(initialAvatarUrl ?? "");
  const [uploadError, setUploadError] = useState("");

  function preview(file?: File) {
    if (!file) return;
    setUploadError("");
    if (file.size > 4 * 1024 * 1024) {
      setUploadError("Choose an image under 4 MB.");
      return;
    }
    if (file.type && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setUploadError("Choose a PNG, JPG or WebP image.");
      return;
    }
    setPreviewUrl(URL.createObjectURL(file));
  }

  return <div className="avatar-upload-row">
    <span className="avatar avatar--profile">{previewUrl ? <img src={previewUrl} alt="Profile photo preview" /> : <Sparkles size={22} />}</span>
    <div className="avatar-upload-copy">
      <label className="button button--soft avatar-upload-button"><ImagePlus size={15} /> Add a photo<input name="avatar" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => preview(event.target.files?.[0])} /></label>
      <span>PNG, JPG or WebP · up to 4 MB</span>
      {uploadError && <span className="upload-error" role="alert">{uploadError}</span>}
    </div>
  </div>;
}

export function ProfileSetupForm({ initialUsername = "", initialNickname = "", initialAvatarUrl = null }: {
  initialUsername?: string;
  initialNickname?: string;
  initialAvatarUrl?: string | null;
}) {
  const [state, action, pending] = useActionState(saveProfile, {} as ActionState);
  return <form action={action} className="profile-form">
    <ProfileAvatarUpload initialAvatarUrl={initialAvatarUrl} />
    <div className="profile-fields">
      <label className="field"><span>Your nickname</span><input name="nickname" type="text" minLength={2} maxLength={40} placeholder="What friends should call you" defaultValue={initialNickname} required /></label>
      <label className="field"><span>Username</span><div className="username-input"><span>@</span><input name="username" type="text" autoCapitalize="none" autoComplete="username" minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}" placeholder="yourname" defaultValue={initialUsername} required /></div><small>3–24 letters, numbers or underscores. You can share this to find friends.</small></label>
    </div>
    {state.error && <p className="form-feedback form-feedback--error" role="alert">{state.error}</p>}
    <button className="button button--primary profile-submit" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={17} /> : <>Save profile <Sparkles size={16} /></>}</button>
  </form>;
}
