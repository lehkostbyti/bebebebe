#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Simple Telegram bot and REST API sharing the mini-app data store.

The bot currently implements only the `/start` command. When a user
starts the bot they receive a welcome message and, if a referral
parameter is present, it is recorded in the user data store. All user
information is persisted to ``user_data/user_data.json`` in JSON format.
This is a simplified example intended for testing and demonstration; in
production you should use a proper database and secure access control.
"""

import json
import os
import sys
import threading
from datetime import datetime
from pathlib import Path
from types import ModuleType
from typing import Any, Dict, List, Optional
from uuid import uuid4


def _ensure_urllib3_appengine_stub() -> None:
    """Provide a stub for urllib3.contrib.appengine when missing.

    python-telegram-bot v13 expects urllib3<2 which still shipped the
    ``urllib3.contrib.appengine`` helper.  Newer urllib3 releases removed this
    module which leads to an ImportError during bot startup.  To keep the bot
    working without forcing a specific urllib3 version we register a minimal
    stub that exposes the attributes accessed by python-telegram-bot.
    """

    try:
        import urllib3.contrib.appengine  # type: ignore[attr-defined]  # noqa: F401
        return
    except ModuleNotFoundError:
        try:
            import urllib3  # type: ignore
            import urllib3.contrib  # type: ignore  # noqa: F401
        except ModuleNotFoundError:
            return

    module = ModuleType('appengine')

    class _AppEngineWarning(RuntimeError):
        """Fallback warning type used when urllib3's original warning is absent."""

    module.AppEnginePlatformWarning = _AppEngineWarning
    module.is_appengine_sandbox = lambda: False
    module.is_appengine = lambda: False
    module.is_local_appengine = lambda: False
    module.is_prod_appengine = lambda: False
    module.HaveAppEngine = False
    module.on_appengine = lambda: False
    module.monkeypatch = lambda: None

    sys.modules['urllib3.contrib.appengine'] = module
    urllib3.contrib.appengine = module  # type: ignore[attr-defined]


_ensure_urllib3_appengine_stub()

from telegram import Update
from telegram.ext import CallbackContext, CommandHandler, Updater

from flask import Flask, request, jsonify


# Используем единую директорию user_data в корне проекта
DATA_FILE = Path(__file__).parent / 'user_data' / 'user_data.json'

# Create Flask app for simple REST API
api_app = Flask(__name__)


def generate_user_id() -> str:
    return uuid4().hex


def now_iso() -> str:
    return datetime.utcnow().isoformat(timespec='seconds') + 'Z'


def last_online_str() -> str:
    return datetime.utcnow().strftime('%a %b %d %Y')


def normalise_user(record: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(record, dict):
        return {}
    data = dict(record)

    telegram_id = data.get('telegram_id')
    if telegram_id in (None, ''):
        data['telegram_id'] = None
    else:
        try:
            data['telegram_id'] = int(telegram_id)
        except (ValueError, TypeError):
            data['telegram_id'] = str(telegram_id)

    user_id = data.get('user_id')
    data['user_id'] = str(user_id) if user_id else generate_user_id()

    data['username'] = data.get('username') or ''
    data['first_name'] = data.get('first_name') or ''
    data['photo_url'] = data.get('photo_url') or ''
    data['region'] = data.get('region') or None
    data['language'] = data.get('language') or None
    data['utc_offset'] = data.get('utc_offset') or None

    referrer = data.get('referrer_id')
    data['referrer_id'] = str(referrer) if referrer else None

    referrals = data.get('referrals') or []
    cleaned_refs = []
    for ref in referrals:
        try:
            ref_id = int(ref)
        except (ValueError, TypeError):
            continue
        if ref_id not in cleaned_refs:
            cleaned_refs.append(ref_id)
    data['referrals'] = cleaned_refs

    data['points_total'] = int(data.get('points_total', data.get('points', 0)) or 0)
    data['points_current'] = int(data.get('points_current', data['points_total']) or 0)
    data['daily_points'] = int(data.get('daily_points', 0) or 0)

    reels_link = data.get('reels_link')
    data['reels_link'] = reels_link if reels_link else None
    data['reels_status'] = data.get('reels_status') or 'pending'

    data['updated_at'] = data.get('updated_at') or now_iso()
    data['moderated_at'] = data.get('moderated_at') or None
    data['last_online'] = data.get('last_online') or last_online_str()

    return data


def merge_user(existing: Optional[Dict[str, Any]], incoming: Dict[str, Any]) -> Dict[str, Any]:
    base = normalise_user(existing or {})
    data = dict(base)

    if 'telegram_id' in incoming and incoming['telegram_id'] not in (None, ''):
        try:
            data['telegram_id'] = int(incoming['telegram_id'])
        except (ValueError, TypeError):
            data['telegram_id'] = str(incoming['telegram_id'])

    if incoming.get('user_id'):
        data['user_id'] = str(incoming['user_id'])
    elif not data.get('user_id'):
        data['user_id'] = generate_user_id()

    for field in ['username', 'first_name', 'photo_url', 'region', 'language', 'utc_offset']:
        value = incoming.get(field)
        if value not in (None, ''):
            data[field] = value

    if incoming.get('referrer_id'):
        data['referrer_id'] = str(incoming['referrer_id'])

    if isinstance(incoming.get('referrals'), list):
        refs = []
        for ref in incoming['referrals']:
            try:
                ref_id = int(ref)
            except (ValueError, TypeError):
                continue
            if ref_id not in refs:
                refs.append(ref_id)
        data['referrals'] = refs

    if 'points_total' in incoming:
        try:
            data['points_total'] = int(incoming['points_total'])
        except (ValueError, TypeError):
            pass
    if 'points_current' in incoming:
        try:
            data['points_current'] = int(incoming['points_current'])
        except (ValueError, TypeError):
            pass
    if 'daily_points' in incoming:
        try:
            data['daily_points'] = int(incoming['daily_points'])
        except (ValueError, TypeError):
            pass
    if 'points' in incoming:
        try:
            points_value = int(incoming['points'])
        except (ValueError, TypeError):
            points_value = data.get('points_total', 0)
        data['points_total'] = points_value
        if data.get('points_current') is None:
            data['points_current'] = points_value

    if incoming.get('reels_link'):
        data['reels_link'] = incoming['reels_link']
    if incoming.get('reels_status'):
        previous = data.get('reels_status')
        data['reels_status'] = incoming['reels_status']
        if previous and previous != data['reels_status']:
            data['moderated_at'] = now_iso()
    if incoming.get('moderated_at'):
        data['moderated_at'] = incoming['moderated_at']

    data['updated_at'] = now_iso()
    data['last_online'] = last_online_str()
    return normalise_user(data)
def load_users() -> Dict[str, Dict[str, Any]]:
    """Load user data from the JSON file into a dictionary keyed by telegram_id."""
    if not DATA_FILE.exists():
        return {}
    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            raw = json.load(f)
    except Exception:
        return {}

    records: List[Dict[str, Any]]
    if isinstance(raw, list):
        records = raw
    elif isinstance(raw, dict):
        records = list(raw.values())
    else:
        records = []

    result: Dict[str, Dict[str, Any]] = {}
    for entry in records:
        user = normalise_user(entry)
        key_source = user.get('telegram_id') if user.get('telegram_id') is not None else user.get('user_id')
        key = str(key_source)
        result[key] = user
    return result


def save_users(users: Dict[str, Dict[str, Any]]) -> None:
    """Persist the users dictionary back to the JSON file."""
    data = [normalise_user(user) for user in users.values()]
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
#                            Flask REST API
# ---------------------------------------------------------------------------

@api_app.route('/api/users', methods=['GET', 'POST'])
def users_endpoint():
    """Endpoint to retrieve or update users.

    GET: Return the list of all users or a single user if `telegram_id` or
         `user_id` query parameter is provided.
    POST: Accept a JSON payload representing a user record. Existing users
         are updated by `telegram_id` (preferred) or `user_id`.
    """
    users = load_users()
    if request.method == 'GET':
        telegram_id = request.args.get('telegram_id')
        user_id = request.args.get('user_id')
        if telegram_id:
            for user in users.values():
                if str(user.get('telegram_id')) == str(telegram_id):
                    return jsonify(user), 200
            return jsonify({}), 200
        if user_id:
            for user in users.values():
                if str(user.get('user_id')) == str(user_id):
                    return jsonify(user), 200
            return jsonify({}), 200
        return jsonify(list(users.values())), 200

    try:
        payload = request.get_json(force=True)
    except Exception:
        return jsonify({'error': 'Invalid JSON payload'}), 400
    if not isinstance(payload, dict):
        return jsonify({'error': 'Invalid JSON payload'}), 400
    if payload.get('telegram_id') is None and not payload.get('user_id'):
        return jsonify({'error': 'telegram_id or user_id required'}), 400

    telegram_id = payload.get('telegram_id')
    user_id = payload.get('user_id')

    existing_user = None
    for key, stored in users.items():
        if telegram_id is not None and stored.get('telegram_id') is not None and str(stored['telegram_id']) == str(telegram_id):
            existing_user = stored
            break
        if user_id and stored.get('user_id') and str(stored['user_id']) == str(user_id):
            existing_user = stored
            break

    merged = merge_user(existing_user, payload)
    key_source = merged.get('telegram_id') if merged.get('telegram_id') is not None else merged.get('user_id')
    key = str(key_source)
    users[key] = merged
    save_users(users)
    return jsonify(merged), 200


def run_api_server():
    """Run the Flask API server in a separate thread."""
    api_app.run(host='0.0.0.0', port=5000, debug=False)


def start_command(update: Update, context: CallbackContext) -> None:
    """Handle the /start command.  Record user and optional referrer."""
    user = update.effective_user
    telegram_key = str(user.id)
    referrer_code = context.args[0] if context.args else None

    users = load_users()
    current_record = users.get(telegram_key)

    payload = {
        'telegram_id': user.id,
        'username': user.username or '',
        'first_name': user.first_name or '',
        'photo_url': getattr(user, 'photo_url', '') or ''
    }

    if current_record is None:
        payload['referrals'] = []
        if referrer_code:
            payload['referrer_id'] = referrer_code
        current_record = merge_user(None, payload)
    else:
        if referrer_code and not current_record.get('referrer_id'):
            payload['referrer_id'] = referrer_code
        current_record = merge_user(current_record, payload)

    if referrer_code:
        referrer_key = None
        for key, record in users.items():
            if str(record.get('user_id')) == str(referrer_code):
                referrer_key = key
                break
        if referrer_key:
            referrer_record = merge_user(users[referrer_key], {})
            referrals = referrer_record.get('referrals', [])
            if user.id not in referrals:
                referrals.append(user.id)
            referrer_record['referrals'] = referrals
            referrer_record['points_total'] = referrer_record.get('points_total', 0) + 10
            referrer_record['points_current'] = referrer_record.get('points_current', 0) + 10
            users[referrer_key] = normalise_user(referrer_record)

    users[telegram_key] = normalise_user(current_record)
    save_users(users)

    welcome_text = (
        '👋 Hello, {name}!\n\n'
        'Welcome to the Instagram Reels Exchange ecosystem.\n'
        'Use the mini‑app to add your Reel and start earning views.\n'
        'If you have any questions, type /help.'
    ).format(name=user.first_name or user.username or 'friend')

    update.message.reply_text(welcome_text)


def main() -> None:
    """Create and run the bot using the Telegram bot token."""
    token = os.getenv('TELEGRAM_BOT_TOKEN')
    if not token:
        raise RuntimeError('Please set the TELEGRAM_BOT_TOKEN environment variable')
    # Start the REST API server in a separate thread
    api_thread = threading.Thread(target=run_api_server, daemon=True)
    api_thread.start()

    # Set up Telegram bot
    updater = Updater(token, use_context=True)
    dp = updater.dispatcher
    dp.add_handler(CommandHandler('start', start_command, pass_args=True))
    # Future commands can be added here
    updater.start_polling()
    updater.idle()


if __name__ == '__main__':
    main()
