import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "python"))

from core import (
    clean_text,
    get_music_files,
    read_title,
    save_tags,
    read_artist,
    read_album,
    read_tracknumber,
    read_total_tracks,
    read_year,
    read_genre,
    read_duration,
    cli_command,
)

ansi_escape = re.compile(r'\x1B\[[0-?]*[ -/]*[@-~]')


def main():
    folder = input("📁 Music folder: ").strip()

    files = get_music_files(folder)

    if not files:
        print("No files found.")
        return

    print(f"\nFound {len(files)} files\n")

    # --- global album data ---
    artist = input("🎤 Artist: ").strip()
    album = input("💿 Album: ").strip()
    year = input("📅 Year: ").strip()

    album_artist = artist

    total = len(files)

    for idx, path in enumerate(files, start=1):

       filename = os.path.basename(path)
       current_title = read_title(path)

       print("\n" + "=" * 70)
       print(f"[{idx}/{total}]")
       print(f"File   : {filename}")
       print(f"Title  : {current_title}")
       print(f"Track auto: {idx}/{total}")
       print("=" * 70)

       suggested = current_title or os.path.splitext(filename)[0]

   # ---- title ----
       new_title = input(f"New title [{suggested}]: ").strip()
       if not new_title:
          new_title = suggested

   # ---- track number ----
       track_input = input(f"Track number [{idx}]: ").strip()

       if track_input:
           try:
               track = int(track_input)
           except ValueError:
               print("⚠ Invalid track number, using auto value")
               track = idx
       else:
           track = idx

       save_tags(
           path=path,
           title=new_title,
           artist=artist,
           album=album,
           album_artist=album_artist,
           year=year,
           track=track,
           total=total
       )

       print(f"✔ Saved (track {track})")

    print("\n✅ Operation completed")


if __name__ == "__main__":
    main()