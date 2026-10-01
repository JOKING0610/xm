import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ThinkingBlock } from './Message';

describe('ThinkingBlock', () => {
  it('流式思考中默认展开并显示思考中状态', () => {
    render(
      <ThinkingBlock
        reasoning="正在分析问题..."
        isStreaming={true}
        isWaitingContent={true}
      />,
    );
    expect(screen.getByText('思考中')).toBeInTheDocument();
    expect(screen.getByText('正在分析问题...')).toBeInTheDocument();
  });

  it('流式结束后自动收起思考过程', async () => {
    const { rerender } = render(
      <ThinkingBlock
        reasoning="思考内容"
        isStreaming={true}
        isWaitingContent={true}
      />,
    );
    expect(screen.getByText('思考内容')).toBeInTheDocument();

    rerender(
      <ThinkingBlock
        reasoning="思考内容"
        isStreaming={false}
        isWaitingContent={false}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText('思考内容')).not.toBeInTheDocument();
    });
  });

  it('流式结束后用户可以手动展开思考过程', async () => {
    const { rerender } = render(
      <ThinkingBlock
        reasoning="思考内容"
        isStreaming={true}
        isWaitingContent={true}
      />,
    );

    rerender(
      <ThinkingBlock
        reasoning="思考内容"
        isStreaming={false}
        isWaitingContent={false}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText('思考内容')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('思考过程'));
    expect(screen.getByText('思考内容')).toBeInTheDocument();
  });

  it('流式结束后用户可以再次收起', async () => {
    const { rerender } = render(
      <ThinkingBlock
        reasoning="思考内容"
        isStreaming={true}
        isWaitingContent={true}
      />,
    );

    rerender(
      <ThinkingBlock
        reasoning="思考内容"
        isStreaming={false}
        isWaitingContent={false}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText('思考内容')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('思考过程'));
    expect(screen.getByText('思考内容')).toBeInTheDocument();

    fireEvent.click(screen.getByText('思考过程'));
    expect(screen.queryByText('思考内容')).not.toBeInTheDocument();
  });

  it('用户手动展开后流式再次开始时保持展开', async () => {
    const { rerender } = render(
      <ThinkingBlock
        reasoning="思考内容"
        isStreaming={false}
        isWaitingContent={false}
      />,
    );

    fireEvent.click(screen.getByText('思考过程'));
    expect(screen.getByText('思考内容')).toBeInTheDocument();

    rerender(
      <ThinkingBlock
        reasoning="新思考内容"
        isStreaming={true}
        isWaitingContent={true}
      />,
    );

    expect(screen.getByText('思考中')).toBeInTheDocument();
    expect(screen.getByText('新思考内容')).toBeInTheDocument();
  });
});
