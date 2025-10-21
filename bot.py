#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Simple Telegram bot for the Instagram Reels exchange ecosystem.

The bot currently implements only the `/start` command.  When a user
starts the bot they receive a welcome message and, if a referral
parameter is present, it is recorded in the user data store.  All
user information is persisted to `user_data/users.json` in
JSON format.  This is a simplified example intended for testing and
demonstration; in production you should use a proper database and
secure access control.
"""

import json
import os
import threading
from pathlib import Path
from typing import Any, Dict

from telegram import Update
from telegram.ext import CallbackContext, CommandHandler, Updater

from flask import Flask, request, jsonify


# Используем единую директорию user_data в корне проекта
DATA_FILE = Path(__file__).parent / 'user_data' / 'users.json'

# Create Flask app for simple REST API
api_app = Flask(__name__)


def load_users() -> Dict[str, Dict[str, Any]]:
    """Load user data from the JSON file into a dictionary keyed by user_id."""
    if DATA_FILE.exists():
        try:
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return {str(u.get('user_id')): u for u in data}
        except Exception:
            # If the file is corrupt, start with an empty dict
            return {}
    return {}


def save_users(users: Dict[str, Dict[str, Any]]) -> None:
    """Persist the users dictionary back to the JSON file."""
    data = list(users.values())
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
#                            Flask REST API
# ---------------------------------------------------------------------------

@api_app.route('/api/users', methods=['GET', 'POST'])
def users_endpoint():
    """Endpoint to retrieve or update users.

    GET: Return the list of all users or a single user if `user_id` query
         parameter is provided.
    POST: Accept a JSON payload representing a user record.  If a user with
         the given `user_id` exists, it will be updated; otherwise it will
         be appended.  Returns the updated user object.
    """
    users = load_users()
    if request.method == 'GET':
        user_id = request.args.get('user_id')
        if user_id:
            return jsonify(users.get(str(user_id), {})), 200
        # return all users
        return jsonify(list(users.values())), 200
    # POST
    try:
        payload = request.get_json(force=True)
    except Exception:
        return jsonify({'error': 'Invalid JSON payload'}), 400
    if not isinstance(payload, dict) or 'user_id' not in payload:
        return jsonify({'error': 'user_id field is required'}), 400
    uid = str(payload['user_id'])
    users[uid] = payload
    save_users(users)
    return jsonify(users[uid]), 200


def run_api_server():
    """Run the Flask API server in a separate thread."""
    api_app.run(host='0.0.0.0', port=5000, debug=False)


def start_command(update: Update, context: CallbackContext) -> None:
    """Handle the /start command.  Record user and optional referrer."""
    user = update.effective_user
    user_id = str(user.id)
    referrer_id = None
    # Extract referral argument if present
    if context.args:
        referrer_id = context.args[0]

    users = load_users()
    # Initialise or update the user record
    if user_id not in users:
        # Initialise extended user record
        users[user_id] = {
            'user_id': user_id,
            'telegram_id': user.id,
            'username': user.username or '',
            'first_name': user.first_name or '',
            'photo_url': user.photo_url if hasattr(user, 'photo_url') else '',
            'region': None,
            'language': None,
            'reels_link': None,
            'reels_status': 'pending',
            'updated_at': None,
            'moderated_at': None,
            'points': 0,
            'daily_points': 0,
            'last_reset': None,
            'referrals': [],
            'referrer_id': referrer_id
        }
        # If the user was referred, increment the referrer’s points and record referral
        if referrer_id and referrer_id in users:
            users[referrer_id].setdefault('referrals', []).append(user_id)
            # Award some points for successful referral
            users[referrer_id]['points'] = users[referrer_id].get('points', 0) + 10
    else:
        # If user exists and there is a new referrer, update it only if not already set
        if referrer_id and not users[user_id].get('referrer_id'):
            users[user_id]['referrer_id'] = referrer_id

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