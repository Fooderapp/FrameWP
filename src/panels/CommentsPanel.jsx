import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { UIIcons } from '../components/UIIcons';

function formatTimestamp(value) {
  if (!Number.isFinite(value)) return 'Now';
  const delta = Math.max(0, Date.now() - value);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getCurrentCommentUserName() {
  return typeof window?.fbData?.currentUser?.displayName === 'string'
    ? window.fbData.currentUser.displayName.trim()
    : '';
}

function getExternalReplyCount(comment, currentUserName) {
  if (!comment || !Array.isArray(comment.messages) || !currentUserName) return 0;
  return comment.messages.slice(1).reduce((count, message) => {
    const author = typeof message?.author === 'string' ? message.author.trim() : '';
    return author && author !== currentUserName ? count + 1 : count;
  }, 0);
}

function CommentAvatar({ author, avatarUrl }) {
  const fallback = (author || '?').trim().charAt(0).toUpperCase() || '?';
  if (avatarUrl) {
    return <img className="fb-comment-avatar" src={avatarUrl} alt={author || 'User'} />;
  }
  return <span className="fb-comment-avatar fb-comment-avatar--fallback">{fallback}</span>;
}

export default function CommentsPanel() {
  const comments = useEditorStore((state) => state.getPageComments());
  const activeCommentId = useEditorStore((state) => state.activeCommentId);
  const activeComment = useEditorStore((state) => state.getActiveComment());
  const setActiveComment = useEditorStore((state) => state.setActiveComment);
  const clearActiveComment = useEditorStore((state) => state.clearActiveComment);
  const addCommentReply = useEditorStore((state) => state.addCommentReply);
  const setCommentResolved = useEditorStore((state) => state.setCommentResolved);
  const deleteCommentThread = useEditorStore((state) => state.deleteCommentThread);
  const pushHistory = useEditorStore((state) => state.pushHistory);
  const activeCanvasTool = useEditorStore((state) => state.activeCanvasTool);
  const setActiveCanvasTool = useEditorStore((state) => state.setActiveCanvasTool);
  const [replyText, setReplyText] = useState('');
  const [listHeight, setListHeight] = useState(240);
  const resizeRef = useRef(null);
  const currentUserName = getCurrentCommentUserName();

  useEffect(() => {
    const handlePointerMove = (event) => {
      const state = resizeRef.current;
      if (!state) return;
      const nextHeight = Math.max(120, Math.min(state.maxHeight, state.startHeight + (event.clientY - state.startY)));
      setListHeight(nextHeight);
    };

    const stopResize = () => {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      document.body.classList.remove('fb-is-resizing-panels');
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, []);

  const orderedComments = useMemo(() => {
    const list = Array.isArray(comments) ? [...comments] : [];
    list.sort((left, right) => {
      if (!!left.resolved !== !!right.resolved) return left.resolved ? 1 : -1;
      return (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0);
    });
    return list;
  }, [comments]);

  const handleReply = () => {
    if (!activeCommentId || !replyText.trim()) return;
    addCommentReply(activeCommentId, replyText);
    setReplyText('');
  };

  return (
    <aside className="fb-right fb-comments-panel">
      <div className="fb-right__header">
        <span>Comments</span>
        <button
          type="button"
          className="fb-secondary-btn fb-btn--sm"
          onClick={() => {
            clearActiveComment();
            setActiveCanvasTool(activeCanvasTool === 'comment' ? 'select' : 'comment');
          }}
        >
          {activeCanvasTool === 'comment' ? 'Exit comment mode' : 'New comment'}
        </button>
      </div>

      <div className="fb-panel-body fb-comments-panel__body">
        <div className="fb-comments-panel__list" style={{ flexBasis: listHeight, minHeight: 120 }}>
          {orderedComments.length ? orderedComments.map((comment) => {
            const preview = comment.messages?.[0]?.text || 'Empty comment';
            const externalReplyCount = getExternalReplyCount(comment, currentUserName);
            return (
              <div
                key={comment.id}
                className={`fb-comments-panel__thread${comment.id === activeCommentId ? ' is-active' : ''}${comment.resolved ? ' is-resolved' : ''}`}
              >
                <button
                  type="button"
                  className="fb-comments-panel__thread-main"
                  onClick={() => {
                    setActiveComment(comment.id);
                    setActiveCanvasTool('comment');
                  }}
                >
                  <span className="fb-comments-panel__thread-avatar-wrap">
                    <CommentAvatar author={comment.author} avatarUrl={comment.avatarUrl} />
                  </span>
                  {externalReplyCount > 0 ? <span className="fb-comments-panel__thread-badge">{externalReplyCount}</span> : null}
                  <span className="fb-comments-panel__thread-copy">
                    <strong>
                      <span className={`fb-comments-panel__thread-status${comment.resolved ? ' is-resolved' : ''}`} aria-hidden="true" />
                      {comment.resolved ? 'Resolved' : 'Open'} comment
                    </strong>
                    <small>{preview}</small>
                  </span>
                  <span className="fb-comments-panel__thread-time-wrap">
                    <span className="fb-comments-panel__thread-time">{formatTimestamp(comment.updatedAt ?? comment.createdAt)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="fb-icon-btn fb-comments-panel__thread-delete"
                  title="Delete comment"
                  aria-label="Delete comment"
                  onClick={() => {
                    deleteCommentThread(comment.id);
                    if (activeCommentId === comment.id) clearActiveComment();
                    pushHistory();
                  }}
                >
                  {UIIcons.trash}
                </button>
              </div>
            );
          }) : (
            <div className="fb-empty-state">
              <div className="fb-empty-state__icon">{UIIcons.variables}</div>
              <div className="fb-empty-state__text">Use the comment tool, then click the canvas to place a note.</div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="fb-comments-panel__splitter"
          aria-label="Resize comments sections"
          onPointerDown={(event) => {
            const panelBody = event.currentTarget.parentElement;
            const rect = panelBody?.getBoundingClientRect();
            if (!rect) return;
            resizeRef.current = {
              startY: event.clientY,
              startHeight: listHeight,
              maxHeight: Math.max(120, rect.height - 160),
            };
            document.body.classList.add('fb-is-resizing-panels');
            event.preventDefault();
          }}
        >
          <span />
        </button>

        <div className="fb-comments-panel__detail">
          {activeComment ? (
            <>
              <div className="fb-comments-panel__detail-head">
                <div>
                  <div className="fb-comments-panel__detail-title">Thread</div>
                  <div className="fb-comments-panel__detail-meta">{activeComment.bpId} artboard • {formatTimestamp(activeComment.createdAt)}</div>
                </div>
                <div className="fb-comments-panel__detail-actions">
                  <button
                    type="button"
                    className="fb-secondary-btn fb-btn--sm"
                    onClick={() => {
                      const nextResolved = !activeComment.resolved;
                      setCommentResolved(activeComment.id, nextResolved);
                      if (nextResolved) clearActiveComment();
                      pushHistory();
                    }}
                  >
                    {activeComment.resolved ? 'Reopen' : 'Mark finished'}
                  </button>
                  <button
                    type="button"
                    className="fb-icon-btn fb-comments-panel__delete-btn"
                    title="Delete comment"
                    aria-label="Delete comment"
                    onClick={() => {
                      deleteCommentThread(activeComment.id);
                      clearActiveComment();
                      pushHistory();
                    }}
                  >
                    {UIIcons.trash}
                  </button>
                </div>
              </div>

              <div className="fb-comments-panel__messages">
                {(activeComment.messages ?? []).map((message) => (
                  <div key={message.id} className="fb-comments-panel__message">
                    <div className="fb-comments-panel__message-head">
                      <div className="fb-comments-panel__message-author">
                        <CommentAvatar author={message.author} avatarUrl={message.avatarUrl} />
                        <strong>{message.author || 'You'}</strong>
                      </div>
                      <span>{formatTimestamp(message.createdAt)}</span>
                    </div>
                    <div className="fb-comments-panel__message-body">{message.text}</div>
                  </div>
                ))}
              </div>

              <div className="fb-comments-panel__composer">
                <textarea
                  className="fb-prop-input"
                  rows={4}
                  placeholder="Reply to this thread"
                  value={replyText}
                  onChange={(event) => setReplyText(event.target.value)}
                />
                <button type="button" className="fb-primary-btn" onClick={handleReply} disabled={!replyText.trim()}>
                  Reply
                </button>
              </div>
            </>
          ) : (
            <div className="fb-empty-state">
              <div className="fb-empty-state__icon">{UIIcons.publish}</div>
              <div className="fb-empty-state__text">Select a comment pin to view the full thread and reply.</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}