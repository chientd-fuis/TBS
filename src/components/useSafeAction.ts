"use client";
import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";

/**
 * Gửi form bằng server action mà KHÔNG để React tự xoá form.
 * React 19: <form action={…}> bị reset sau MỌI lần gửi, kể cả khi lỗi → mất hết dữ liệu đã nhập
 * (ô giờ TimeInput cũng nghe sự kiện reset). Hook này gửi qua onSubmit:
 *  - lỗi → giữ nguyên mọi ô, chỉ hiện lỗi;
 *  - thành công → reset form (như trước) – tắt bằng resetOnOk: false.
 */
export function useSafeAction<S extends { ok?: boolean } | null>(
  action: (s: Awaited<S>, fd: FormData) => S | Promise<S>,
  init: Awaited<S>,
  opts: { resetOnOk?: boolean } = {},
) {
  const [state, dispatch, pending] = useActionState<S, FormData>(action, init);
  const formRef = useRef<HTMLFormElement>(null);
  const resetOnOk = opts.resetOnOk !== false;

  /** gửi form (submitter: nút đã bấm – giữ name/value của nút như form gửi thường) */
  const submit = (form: HTMLFormElement, submitter?: Element | null) => {
    const fd = new FormData(form);
    if (submitter instanceof HTMLButtonElement && submitter.name) fd.append(submitter.name, submitter.value);
    startTransition(() => dispatch(fd));
  };
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submit(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
  };

  useEffect(() => {
    if (state?.ok && resetOnOk) formRef.current?.reset();
  }, [state, resetOnOk]);

  return { state, pending, formRef, onSubmit, submit };
}
